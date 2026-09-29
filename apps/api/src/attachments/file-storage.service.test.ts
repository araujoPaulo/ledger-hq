import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConfigService } from '@nestjs/config'
import { FileStorageService } from './file-storage.service.js'

const OBLIGATION = '0199f7b0-0000-7000-8000-000000000001'
const ATTACHMENT = '0199f7b0-0000-7000-8000-000000000002'

let root: string
let storage: FileStorageService

function configWith(dir: string): ConfigService {
  return { getOrThrow: () => dir } as unknown as ConfigService
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ledger-hq-storage-'))
  storage = new FileStorageService(configWith(root))
})

describe('pathFor', () => {
  it('builds the path from the two ids and nothing else', () => {
    expect(storage.pathFor(OBLIGATION, ATTACHMENT)).toBe(join(root, OBLIGATION, ATTACHMENT))
  })

  // The controller validates both ids as uuids (Task 1), so this can only
  // fire if someone later calls the service from somewhere that does not.
  // It is the last line of defence, so it is a real one.
  it.each(['..', '../..', `..${sep}..${sep}etc${sep}passwd`, 'a/b', '', 'x\0y'])(
    'refuses %j rather than escaping the root',
    (bad) => {
      expect(() => storage.pathFor(OBLIGATION, bad)).toThrow(/attachment id/i)
      expect(() => storage.pathFor(bad, ATTACHMENT)).toThrow(/obligation id/i)
    },
  )
})

describe('write', () => {
  it('writes the bytes and leaves no temporary file behind', async () => {
    await storage.write(OBLIGATION, ATTACHMENT, Buffer.from('%PDF-1.7 receipt'))

    expect(await readFile(storage.pathFor(OBLIGATION, ATTACHMENT))).toEqual(Buffer.from('%PDF-1.7 receipt'))
    expect(await readdir(join(root, OBLIGATION))).toEqual([ATTACHMENT])
  })

  it('creates the obligation directory on first write', async () => {
    await storage.write(OBLIGATION, ATTACHMENT, Buffer.from('x'))

    expect(await readdir(root)).toContain(OBLIGATION)
  })

  it('replaces an existing file rather than appending to it', async () => {
    await storage.write(OBLIGATION, ATTACHMENT, Buffer.from('first'))
    await storage.write(OBLIGATION, ATTACHMENT, Buffer.from('second'))

    expect(await readFile(storage.pathFor(OBLIGATION, ATTACHMENT), 'utf8')).toBe('second')
  })

  // These are plaintext receipts (design §3.2): the directory's permissions
  // are the only barrier left, so owner-only is load-bearing, not tidiness.
  // Windows has no POSIX mode bits to assert on, so this is skipped there.
  // The mask (`& 0o777`) strips the file-type bits `stat` reports alongside
  // the permission bits, so the comparison is exact on the bits that matter
  // without being sensitive to how the platform encodes the rest of `mode`.
  it.skipIf(process.platform === 'win32')('writes the file and the obligation directory owner-only', async () => {
    await storage.write(OBLIGATION, ATTACHMENT, Buffer.from('x'))

    const fileMode = (await stat(storage.pathFor(OBLIGATION, ATTACHMENT))).mode & 0o777
    const dirMode = (await stat(join(root, OBLIGATION))).mode & 0o777

    expect(fileMode).toBe(0o600)
    expect(dirMode).toBe(0o700)
  })

  // Two writes for the same id — a doubled submit, a retry — must not share
  // one temporary file: if they did, one write's bytes could land on the
  // other's temp path before either rename fires, corrupting the result.
  it('does not corrupt the result when two writes for the same id race', async () => {
    const first = Buffer.alloc(64_000, 'a')
    const second = Buffer.alloc(64_000, 'b')

    await Promise.all([
      storage.write(OBLIGATION, ATTACHMENT, first),
      storage.write(OBLIGATION, ATTACHMENT, second),
    ])

    const written = await readFile(storage.pathFor(OBLIGATION, ATTACHMENT))
    expect([first, second]).toContainEqual(written)
  })
})

describe('read', () => {
  it('returns the exact bytes that were written', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00])
    await storage.write(OBLIGATION, ATTACHMENT, bytes)

    expect(await storage.read(OBLIGATION, ATTACHMENT)).toEqual(bytes)
  })

  it('raises rather than returning empty when the file is gone', async () => {
    await expect(storage.read(OBLIGATION, ATTACHMENT)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('exists', () => {
  it('is false before a write and true after it', async () => {
    expect(await storage.exists(OBLIGATION, ATTACHMENT)).toBe(false)
    await storage.write(OBLIGATION, ATTACHMENT, Buffer.from('x'))
    expect(await storage.exists(OBLIGATION, ATTACHMENT)).toBe(true)
  })
})

describe('remove', () => {
  it('deletes the file', async () => {
    await storage.write(OBLIGATION, ATTACHMENT, Buffer.from('x'))

    await storage.remove(OBLIGATION, ATTACHMENT)

    expect(await storage.exists(OBLIGATION, ATTACHMENT)).toBe(false)
  })

  // A delete runs row-first (design §3.3), so by the time this is called the
  // row is already gone. Throwing here would fail a request that has, from
  // the operator's point of view, already succeeded.
  it('is a no-op when the file is already gone', async () => {
    await expect(storage.remove(OBLIGATION, ATTACHMENT)).resolves.toBeUndefined()
  })
})

describe('a pre-existing stray temporary file', () => {
  it('does not become visible as an attachment', async () => {
    await storage.write(OBLIGATION, ATTACHMENT, Buffer.from('real'))
    await writeFile(`${storage.pathFor(OBLIGATION, ATTACHMENT)}.tmp`, 'half-written')

    // Readers address a file by its id; the .tmp suffix is not an id, so a
    // crash mid-write can never be served as an attachment.
    expect(await readFile(storage.pathFor(OBLIGATION, ATTACHMENT), 'utf8')).toBe('real')
  })
})
