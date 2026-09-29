import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from 'uuidv7'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app.js'
import { getTestPrisma, resetDatabase } from './database.js'
import { authenticate } from './authenticate.js'

const prisma = getTestPrisma()

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])

let app: INestApplication
let cookie: string[]

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

async function anObligation(taxId: string): Promise<string> {
  const client = await prisma.client.create({
    data: { id: uuidv7(), kind: 'COMPANY', name: 'Anexos, Lda.', taxId, accounting: 'ORGANIZED', legalForm: 'LDA' },
  })
  await prisma.obligationDefinition.upsert({
    where: { code: 'TEST_ATTACHMENTS' },
    update: {},
    create: { code: 'TEST_ATTACHMENTS', name: 'Test obligation', authority: 'TAX', periodicity: 'MONTHLY', source: 'CUSTOM' },
  })
  const obligation = await prisma.obligationInstance.create({
    data: {
      id: uuidv7(),
      clientId: client.id,
      definitionCode: 'TEST_ATTACHMENTS',
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-01-31T00:00:00Z'),
      periodLabel: '2026-01',
      dueDate: new Date('2026-02-20T00:00:00Z'),
    },
  })
  return obligation.id
}

function upload(obligationId: string, bytes: Buffer, filename: string, contentType: string) {
  return request(app.getHttpServer())
    .post(`/api/v1/obligations/${obligationId}/attachments`)
    .set('Cookie', cookie)
    .set('X-Requested-With', 'ledger-hq')
    .attach('file', bytes, { filename, contentType })
}

describe('attachment upload, list, download and delete', () => {
  it('round-trips the exact bytes', async () => {
    const obligationId = await anObligation('509111111')

    const created = await upload(obligationId, PDF, 'recibo.pdf', 'application/pdf').expect(201)
    expect(created.body).toMatchObject({
      obligationId,
      filename: 'recibo.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF.length,
    })
    expect(created.body.sha256).toBeUndefined()

    const listed = await request(app.getHttpServer())
      .get(`/api/v1/obligations/${obligationId}/attachments`)
      .set('Cookie', cookie)
      .expect(200)
    expect(listed.body).toHaveLength(1)

    const downloaded = await request(app.getHttpServer())
      .get(`/api/v1/obligations/${obligationId}/attachments/${created.body.id}`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => callback(null, Buffer.concat(chunks)))
      })
      .expect(200)

    expect(downloaded.body).toEqual(PDF)
    expect(downloaded.headers['content-type']).toContain('application/pdf')
    expect(downloaded.headers['content-disposition']).toBe(
      `attachment; filename="recibo.pdf"; filename*=UTF-8''recibo.pdf`,
    )

    await request(app.getHttpServer())
      .delete(`/api/v1/obligations/${obligationId}/attachments/${created.body.id}`)
      .set('Cookie', cookie)
      .set('X-Requested-With', 'ledger-hq')
      .expect(204)

    const afterDelete = await request(app.getHttpServer())
      .get(`/api/v1/obligations/${obligationId}/attachments`)
      .set('Cookie', cookie)
      .expect(200)
    expect(afterDelete.body).toEqual([])
  })

  it('keeps a non-ASCII filename intact in the header', async () => {
    const obligationId = await anObligation('509222222')
    const created = await upload(obligationId, PDF, 'Declaração periódica.pdf', 'application/pdf').expect(201)

    const downloaded = await request(app.getHttpServer())
      .get(`/api/v1/obligations/${obligationId}/attachments/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(200)

    expect(downloaded.headers['content-disposition']).toContain(
      `filename*=UTF-8''Declara%C3%A7%C3%A3o%20peri%C3%B3dica.pdf`,
    )
    expect(downloaded.headers['content-disposition']).toContain('filename="Declaracao periodica.pdf"')
  })

  it('rejects a PNG declared as a PDF', async () => {
    const obligationId = await anObligation('509333333')

    const response = await upload(obligationId, PNG, 'fake.pdf', 'application/pdf').expect(415)

    expect(response.body.error.code).toBe('attachments.type_not_allowed')
    expect(await prisma.obligationAttachment.count()).toBe(0)
  })

  it('answers 410 attachments.file_missing when the row outlived its file', async () => {
    const obligationId = await anObligation('509444444')
    const created = await upload(obligationId, PDF, 'recibo.pdf', 'application/pdf').expect(201)

    // Exactly what a dump and a file archive from different nights produce.
    await rm(join(process.env.ATTACHMENTS_DIR!, obligationId, String(created.body.id)), { force: true })

    const response = await request(app.getHttpServer())
      .get(`/api/v1/obligations/${obligationId}/attachments/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(410)

    expect(response.body.error.code).toBe('attachments.file_missing')
  })

  it('cascades the rows when the obligation is deleted', async () => {
    const obligationId = await anObligation('509555555')
    await upload(obligationId, PDF, 'recibo.pdf', 'application/pdf').expect(201)

    await prisma.obligationInstance.delete({ where: { id: obligationId } })

    expect(await prisma.obligationAttachment.count()).toBe(0)
  })

  it('refuses an upload for an obligation that does not exist', async () => {
    const response = await upload(uuidv7(), PDF, 'recibo.pdf', 'application/pdf').expect(404)

    expect(response.body.error.code).toBe('common.not_found')
  })

  it('refuses an id that is not a uuid, before it can reach a path', async () => {
    const obligationId = await anObligation('509666666')

    const response = await request(app.getHttpServer())
      .get(`/api/v1/obligations/${obligationId}/attachments/..`)
      .set('Cookie', cookie)

    expect([404, 422]).toContain(response.status)
    expect(response.body.error.code).not.toBe('common.internal_error')
  })

  it('rejects an upload with no X-Requested-With header', async () => {
    const obligationId = await anObligation('509777777')

    const response = await request(app.getHttpServer())
      .post(`/api/v1/obligations/${obligationId}/attachments`)
      .set('Cookie', cookie)
      .attach('file', PDF, { filename: 'recibo.pdf', contentType: 'application/pdf' })
      .expect(403)

    expect(response.body.error.code).toBe('common.forbidden')
  })

  it('rejects every route without a session', async () => {
    const obligationId = await anObligation('509888888')

    const response = await request(app.getHttpServer()).get(`/api/v1/obligations/${obligationId}/attachments`).expect(401)

    expect(response.body).toEqual({ error: { code: 'auth.session_expired', params: {} } })
  })
})
