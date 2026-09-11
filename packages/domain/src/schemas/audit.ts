import { z } from 'zod'

/**
 * Deliberately generic — `AuditEvent` (Phase 0) already models entityType /
 * entityId / action / metadata as free-form strings and JSON, and this is
 * its first HTTP-facing producer, not the reason to constrain it further.
 */
export const createAuditEventSchema = z
  .object({
    entityType: z.string().trim().min(1).max(50),
    entityId: z.string().trim().min(1).max(200),
    action: z.string().trim().min(1).max(100),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export type CreateAuditEventInput = z.infer<typeof createAuditEventSchema>
