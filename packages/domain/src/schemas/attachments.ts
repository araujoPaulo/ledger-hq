import { z } from 'zod'
import { uuidSchema } from './common'

/**
 * A portal PDF, or a phone photo of a stamped counterfoil. Every extra type
 * is another format the download route can be talked into serving.
 */
export const ACCEPTED_ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const

export type AcceptedAttachmentType = (typeof ACCEPTED_ATTACHMENT_TYPES)[number]

/**
 * 10 MiB. A portal PDF is tens of kilobytes and a phone photo two to five
 * megabytes; this leaves headroom for a multi-page scan without letting a
 * mis-click park a video on the volume.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/**
 * The stored path is `<root>/<obligationId>/<id>` and nothing else (design
 * §3.2). Validating both halves as uuids at the edge is what makes that a
 * safe `join()` rather than a traversal waiting to happen — the storage
 * service asserts the same thing again, because defence that exists in one
 * place only is defence that moves when the code does.
 */
export const attachmentParamsSchema = z.object({ obligationId: uuidSchema, id: uuidSchema }).strict()

export type AttachmentParams = z.infer<typeof attachmentParamsSchema>

export const obligationParamsSchema = z.object({ obligationId: uuidSchema }).strict()

export type ObligationParams = z.infer<typeof obligationParamsSchema>
