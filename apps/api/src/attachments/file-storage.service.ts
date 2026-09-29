import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Injectable } from '@nestjs/common'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ConfigService } from '@nestjs/config'

/** Lowercase hex uuid with dashes — the shape `uuidv7()` produces. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The attachment bytes, and only the bytes. It knows nothing about rows,
 * obligations or content types.
 *
 * Every path it produces is `<root>/<obligationId>/<attachmentId>`, built
 * from two values it has itself checked are uuids. The filename the operator
 * uploaded is never involved: it is an arbitrary string that can traverse
 * (`../../etc/passwd`), collide under case-insensitive or
 * Unicode-normalising filesystems, or exceed `NAME_MAX` (design §3.2).
 */
@Injectable()
export class FileStorageService {
  private readonly root: string

  constructor(config: ConfigService) {
    this.root = config.getOrThrow<string>('ATTACHMENTS_DIR')
    // Synchronous, in the constructor, on purpose: a directory that cannot
    // be created is a misconfigured deployment, and the process should
    // refuse to come up rather than accept an upload it cannot store.
    //
    // Owner-only (0o700): the receipts stored under here are kept in
    // plaintext (design §3.2's own tradeoff), so this directory's
    // permissions are the only barrier left.
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
  }

  pathFor(obligationId: string, attachmentId: string): string {
    if (!UUID.test(obligationId)) throw new Error(`obligation id is not a uuid: ${JSON.stringify(obligationId)}`)
    if (!UUID.test(attachmentId)) throw new Error(`attachment id is not a uuid: ${JSON.stringify(attachmentId)}`)

    return join(this.root, obligationId, attachmentId)
  }

  /**
   * Atomic against a crash mid-stream: the bytes land on a per-call temporary
   * file and are renamed into place, so a half-written file is never visible
   * under the real name. `rename` within one directory is atomic on every
   * filesystem this runs on.
   *
   * The temporary name carries a random suffix, not just the attachment id:
   * two concurrent writes for the same id (a doubled submit, a retry) would
   * otherwise share one `.tmp` path and could interleave their bytes before
   * either `rename` fires.
   */
  async write(obligationId: string, attachmentId: string, bytes: Buffer): Promise<void> {
    const path = this.pathFor(obligationId, attachmentId)
    // Owner-only (0o700) — see the constructor's note on why.
    await mkdir(join(this.root, obligationId), { recursive: true, mode: 0o700 })

    const temporary = `${path}.${randomUUID()}.tmp`
    // Owner-only (0o600): these are plaintext receipts (design §3.2).
    await writeFile(temporary, bytes, { mode: 0o600 })
    await rename(temporary, path)
  }

  async read(obligationId: string, attachmentId: string): Promise<Buffer> {
    return readFile(this.pathFor(obligationId, attachmentId))
  }

  async exists(obligationId: string, attachmentId: string): Promise<boolean> {
    try {
      await stat(this.pathFor(obligationId, attachmentId))
      return true
    } catch {
      return false
    }
  }

  /** Idempotent: the row is deleted first, so the file may already be gone. */
  async remove(obligationId: string, attachmentId: string): Promise<void> {
    await rm(this.pathFor(obligationId, attachmentId), { force: true })
  }
}
