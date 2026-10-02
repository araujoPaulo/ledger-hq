import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { AppError, ACCEPTED_ATTACHMENT_TYPES } from '@ledger-hq/domain'
import type { AcceptedAttachmentType } from '@ledger-hq/domain'
import { uuidv7 } from 'uuidv7'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ObligationsService } from '../obligations/obligations.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { FileStorageService } from './file-storage.service.js'
import type { ObligationAttachment } from '../generated/prisma/client.js'

/**
 * Leading bytes, in the order they are checked. Long signatures first so a
 * shorter prefix can never shadow a longer one.
 */
const SIGNATURES: Array<{ type: AcceptedAttachmentType; magic: readonly number[] }> = [
  { type: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { type: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
]

export function sniffContentType(bytes: Buffer): AcceptedAttachmentType | null {
  for (const { type, magic } of SIGNATURES) {
    if (bytes.length < magic.length) continue
    if (magic.every((byte, index) => bytes[index] === byte)) return type
  }

  return null
}

/**
 * A multipart part's declared `Content-Type` is chosen by the client and is
 * not evidence (design §3.4). The bytes decide, and the declaration has to
 * agree with them — a mismatch is rejected exactly as an unaccepted type is,
 * because both mean the same thing: this is not the file it claims to be.
 */
export function assertAcceptable(declaredType: string, bytes: Buffer): AcceptedAttachmentType {
  // `image/jpeg; charset=binary` is a legitimate thing for a browser to send.
  const declared = declaredType.split(';')[0]?.trim().toLowerCase() ?? ''
  const sniffed = sniffContentType(bytes)

  if (sniffed === null || declared !== sniffed || !(ACCEPTED_ATTACHMENT_TYPES as readonly string[]).includes(declared)) {
    throw new AppError('attachments.type_not_allowed', { contentType: declaredType }, 415)
  }

  return sniffed
}

export type AttachmentResponse = {
  id: string
  obligationId: string
  filename: string
  contentType: string
  sizeBytes: number
  uploadedAt: string
}

/** `sha256` stays off the wire: it exists for restore reconciliation (design §4.3). */
function toResponse(row: ObligationAttachment): AttachmentResponse {
  return {
    id: row.id,
    obligationId: row.obligationId,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.uploadedAt.toISOString(),
  }
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
    private readonly obligations: ObligationsService,
  ) {}

  /**
   * File first, row second (design §3.3). There is no transaction spanning
   * two systems, so the order is chosen by which failure is survivable: a
   * file with no row is invisible to every reader and reclaimed by the
   * sweep; a row with no file is a listed, clickable attachment that fails
   * when clicked, which is a lie about evidence.
   */
  async upload(
    obligationId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ): Promise<AttachmentResponse> {
    // Throws common.not_found for an obligation that does not exist, before
    // anything is written anywhere.
    await this.obligations.findOne(obligationId)

    const contentType = assertAcceptable(file.mimetype, file.buffer)
    const id = uuidv7()

    await this.storage.write(obligationId, id, file.buffer)

    const row = await this.prisma.obligationAttachment.create({
      data: {
        id,
        obligationId,
        filename: file.originalname,
        contentType,
        sizeBytes: file.buffer.length,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
      },
    })

    return toResponse(row)
  }

  async list(obligationId: string): Promise<AttachmentResponse[]> {
    const rows = await this.prisma.obligationAttachment.findMany({
      where: { obligationId },
      orderBy: { uploadedAt: 'asc' },
    })

    return rows.map(toResponse)
  }

  async download(obligationId: string, id: string): Promise<{ bytes: Buffer; filename: string; contentType: string }> {
    const row = await this.findRow(obligationId, id)

    if (!(await this.storage.exists(obligationId, id))) {
      // A row that outlived its file — a restore across mismatched archives,
      // or a failed upload's row that never existed. Say so in a code the
      // UI can translate, rather than a 500 that reads like a bug.
      throw new AppError('attachments.file_missing', { attachmentId: id }, 410)
    }

    return { bytes: await this.storage.read(obligationId, id), filename: row.filename, contentType: row.contentType }
  }

  /** Row first, file second — the mirror of `upload`, for the same reason. */
  async remove(obligationId: string, id: string): Promise<void> {
    await this.findRow(obligationId, id)

    await this.prisma.obligationAttachment.delete({ where: { id } })
    await this.storage.remove(obligationId, id)
  }

  /**
   * Scoped to the obligation in the URL, not looked up by id alone: without
   * the scope, an id from one obligation would resolve under another
   * obligation's path and read a file that is not there — or, worse, be
   * deleted through a URL that does not name it.
   */
  private async findRow(obligationId: string, id: string): Promise<ObligationAttachment> {
    const row = await this.prisma.obligationAttachment.findFirst({ where: { id, obligationId } })
    if (!row) throw new AppError('common.not_found', {}, 404)

    return row
  }
}
