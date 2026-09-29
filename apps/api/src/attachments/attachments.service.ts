import { AppError } from '@ledger-hq/domain'
import { ACCEPTED_ATTACHMENT_TYPES } from '@ledger-hq/domain'
import type { AcceptedAttachmentType } from '@ledger-hq/domain'

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
