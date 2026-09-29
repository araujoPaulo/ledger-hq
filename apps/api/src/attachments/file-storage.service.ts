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
    mkdirSync(this.root, { recursive: true })
  }

  pathFor(obligationId: string, attachmentId: string): string {
    if (!UUID.test(obligationId)) throw new Error(`obligation id is not a uuid: ${JSON.stringify(obligationId)}`)
    if (!UUID.test(attachmentId)) throw new Error(`attachment id is not a uuid: ${JSON.stringify(attachmentId)}`)

    return join(this.root, obligationId, attachmentId)
  }

  /**
   * Atomic against a crash mid-stream: the bytes land on `<path>.tmp` and are
   * renamed into place, so a half-written file is never visible under the
   * real name. `rename` within one directory is atomic on every filesystem
   * this runs on.
   */
  async write(obligationId: string, attachmentId: string, bytes: Buffer): Promise<void> {
    const path = this.pathFor(obligationId, attachmentId)
    await mkdir(join(this.root, obligationId), { recursive: true })

    const temporary = `${path}.tmp`
    await writeFile(temporary, bytes)
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
