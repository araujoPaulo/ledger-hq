import { z } from 'zod'
import { AUTH_KIND_VALUES } from '../enums'

export const createPlatformSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    url: z.string().trim().url().max(500).optional(),
    authKind: z.enum(AUTH_KIND_VALUES),
  })
  .strict()

export const updatePlatformSchema = createPlatformSchema.partial()

export type CreatePlatformInput = z.infer<typeof createPlatformSchema>
export type UpdatePlatformInput = z.infer<typeof updatePlatformSchema>
