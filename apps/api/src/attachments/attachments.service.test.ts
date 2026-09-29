import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AppError } from '@ledger-hq/domain'
import { AttachmentsService, assertAcceptable, sniffContentType } from './attachments.service.js'
import type { FileStorageService } from './file-storage.service.js'
import type { PrismaService } from '../common/prisma.service.js'
import type { ObligationsService } from '../obligations/obligations.service.js'

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])

describe('sniffContentType', () => {
  it.each([
    ['application/pdf', PDF],
    ['image/png', PNG],
    ['image/jpeg', JPEG],
  ])('recognises %s from its leading bytes', (expected, bytes) => {
    expect(sniffContentType(bytes)).toBe(expected)
  })

  it.each([
    ['a zip, which PDFs are often confused with', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
    ['an ELF binary', Buffer.from([0x7f, 0x45, 0x4c, 0x46])],
    ['plain text', Buffer.from('hello, this is not a receipt')],
    ['an empty buffer', Buffer.alloc(0)],
    ['a buffer shorter than any signature', Buffer.from([0x25, 0x50])],
  ])('returns null for %s', (_label, bytes) => {
    expect(sniffContentType(bytes)).toBeNull()
  })
})

describe('assertAcceptable', () => {
  it('returns the sniffed type when the declaration agrees', () => {
    expect(assertAcceptable('application/pdf', PDF)).toBe('application/pdf')
  })

  it('tolerates a charset parameter on the declared type', () => {
    expect(assertAcceptable('application/pdf; charset=binary', PDF)).toBe('application/pdf')
  })

  // The multipart part's Content-Type is chosen by the client. It is a
  // label, not evidence (design §3.4).
  it('rejects a PNG declared as a PDF', () => {
    expect(() => assertAcceptable('application/pdf', PNG)).toThrow(AppError)
    try {
      assertAcceptable('application/pdf', PNG)
    } catch (error) {
      expect((error as AppError).code).toBe('attachments.type_not_allowed')
      expect((error as AppError).status).toBe(415)
    }
  })

  it('rejects a file whose bytes match nothing accepted, however it is labelled', () => {
    const bytes = Buffer.from('#!/bin/sh\nrm -rf /')
    expect(() => assertAcceptable('application/pdf', bytes)).toThrow(AppError)
    try {
      assertAcceptable('application/pdf', bytes)
    } catch (error) {
      expect((error as AppError).code).toBe('attachments.type_not_allowed')
    }
  })

  it('rejects an accepted-looking file declared as an unaccepted type', () => {
    expect(() => assertAcceptable('application/zip', PDF)).toThrow(AppError)
    try {
      assertAcceptable('application/zip', PDF)
    } catch (error) {
      expect((error as AppError).code).toBe('attachments.type_not_allowed')
      expect((error as AppError).params).toMatchObject({ contentType: 'application/zip' })
    }
  })
})

const OBLIGATION = '0199f7b0-0000-7000-8000-000000000001'

function fakes(
  overrides: { createFails?: boolean; writeFails?: boolean; fileMissing?: boolean; removeFails?: boolean } = {},
) {
  const written: string[] = []
  const rows: Array<Record<string, unknown>> = []

  const storage = {
    async write(obligationId: string, attachmentId: string) {
      if (overrides.writeFails) throw new Error('ENOSPC: no space left on device')
      written.push(`${obligationId}/${attachmentId}`)
    },
    async read() {
      return Buffer.from('%PDF-1.7')
    },
    async exists() {
      return overrides.fileMissing !== true
    },
    async remove(obligationId: string, attachmentId: string) {
      // The row is deleted before this runs (design §3.3's mirror): a
      // storage failure here must not resurrect the row, and the already-
      // deleted row must not be masked by this failing first.
      if (overrides.removeFails) throw new Error('EACCES: permission denied')
      const index = written.indexOf(`${obligationId}/${attachmentId}`)
      if (index >= 0) written.splice(index, 1)
    },
  } as unknown as FileStorageService

  const prisma = {
    obligationAttachment: {
      async create({ data }: { data: Record<string, unknown> }) {
        if (overrides.createFails) throw new Error('duplicate key value violates unique constraint')
        rows.push({ ...data, uploadedAt: new Date('2026-03-01T10:00:00Z') })
        return rows.at(-1)
      },
      // The where clauses are honoured, not ignored: two of the tests below
      // are precisely about an id being scoped to its obligation.
      async findMany({ where }: { where: { obligationId: string } }) {
        return rows.filter((row) => row.obligationId === where.obligationId)
      },
      async findFirst({ where }: { where: { id: string; obligationId: string } }) {
        return rows.find((row) => row.id === where.id && row.obligationId === where.obligationId) ?? null
      },
      async delete({ where }: { where: { id: string } }) {
        const index = rows.findIndex((row) => row.id === where.id)
        return rows.splice(index, 1)[0]
      },
    },
  } as unknown as PrismaService

  const obligations = { async findOne() {} } as unknown as ObligationsService

  return { service: new AttachmentsService(prisma, storage, obligations), written, rows }
}

const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const file = { originalname: 'Declaração.pdf', mimetype: 'application/pdf', buffer: PDF_BYTES }

describe('upload ordering', () => {
  it('writes the file, then the row', async () => {
    const { service, written, rows } = fakes()

    const response = await service.upload(OBLIGATION, file)

    expect(written).toHaveLength(1)
    expect(rows).toHaveLength(1)
    expect(response).toMatchObject({
      obligationId: OBLIGATION,
      filename: 'Declaração.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF_BYTES.length,
    })
    expect(response.uploadedAt).toBe('2026-03-01T10:00:00.000Z')
  })

  it('records the sha256 of the bytes, not of the name', async () => {
    const { service, rows } = fakes()

    await service.upload(OBLIGATION, file)

    // sha256 of the eight bytes of "%PDF-1.7".
    expect(rows[0]?.sha256).toBe(createHash('sha256').update(PDF_BYTES).digest('hex'))
  })

  // This is the ordering decision itself (design §3.3): an orphan file is
  // invisible disk waste, reclaimed by the sweep; an orphan row would be a
  // listed, clickable attachment that fails when clicked.
  it('leaves an orphan file, and no row, when the row write fails', async () => {
    const { service, written, rows } = fakes({ createFails: true })

    await expect(service.upload(OBLIGATION, file)).rejects.toThrow(/duplicate key/)

    expect(written).toHaveLength(1)
    expect(rows).toHaveLength(0)
  })

  it('writes no row at all when the file write fails', async () => {
    const { service, rows } = fakes({ writeFails: true })

    await expect(service.upload(OBLIGATION, file)).rejects.toThrow(/ENOSPC/)

    expect(rows).toHaveLength(0)
  })

  it('rejects a file whose bytes are not an accepted type before touching either store', async () => {
    const { service, written, rows } = fakes()

    await expect(
      service.upload(OBLIGATION, { originalname: 'x.pdf', mimetype: 'application/pdf', buffer: Buffer.from('not a pdf') }),
    ).rejects.toMatchObject({ code: 'attachments.type_not_allowed' })

    expect(written).toHaveLength(0)
    expect(rows).toHaveLength(0)
  })
})

describe('download', () => {
  it('returns the bytes, the stored name and the sniffed type', async () => {
    const { service } = fakes()
    const uploaded = await service.upload(OBLIGATION, file)

    const downloaded = await service.download(OBLIGATION, uploaded.id)

    expect(downloaded.filename).toBe('Declaração.pdf')
    expect(downloaded.contentType).toBe('application/pdf')
    expect(downloaded.bytes).toEqual(Buffer.from('%PDF-1.7'))
  })

  // Exactly what restoring a dump and a file archive from different nights
  // produces (design §4.3): the row survived, the file did not.
  it('answers attachments.file_missing when the row outlived its file', async () => {
    const { service } = fakes({ fileMissing: true })
    const uploaded = await service.upload(OBLIGATION, file)

    await expect(service.download(OBLIGATION, uploaded.id)).rejects.toMatchObject({
      code: 'attachments.file_missing',
      status: 410,
    })
  })

  it('answers common.not_found for an id belonging to another obligation', async () => {
    const { service } = fakes()
    await service.upload(OBLIGATION, file)

    await expect(service.download('0199f7b0-0000-7000-8000-0000000000ff', '0199f7b0-0000-7000-8000-0000000000fe')).rejects.toMatchObject({
      code: 'common.not_found',
      status: 404,
    })
  })
})

describe('remove ordering', () => {
  it('deletes the row before the file', async () => {
    const { service, written, rows } = fakes()
    await service.upload(OBLIGATION, file)
    const uploaded = (await service.list(OBLIGATION))[0]!

    await service.remove(OBLIGATION, uploaded.id)

    expect(rows).toHaveLength(0)
    expect(written).toHaveLength(0)
  })

  // The interleaving the brief's example left unpinned: storage.remove()
  // throws after the row is already gone. remove() is not wrapped in
  // try/catch, so the row deletion is never undone — the same symmetric
  // guarantee as upload, mirrored: the row (the record of evidence) is
  // gone first, and a leftover file is again invisible disk waste, not a
  // dangling reference someone can click.
  it('leaves the row deleted even when the file remove fails afterward', async () => {
    const { service, rows, written } = fakes({ removeFails: true })
    await service.upload(OBLIGATION, file)
    const uploaded = (await service.list(OBLIGATION))[0]!

    await expect(service.remove(OBLIGATION, uploaded.id)).rejects.toThrow(/EACCES/)

    expect(rows).toHaveLength(0)
    expect(written).toHaveLength(1)
  })
})
