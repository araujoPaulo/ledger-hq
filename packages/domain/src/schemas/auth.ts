import { z } from 'zod'
import { base64Schema } from './common'

/** 32 bytes, base64: 43 characters plus one '=' of padding. */
const derivedKeySchema = base64Schema.length(44)

/** 16 bytes, base64: 22 characters plus two '=' of padding. */
const saltSchema = base64Schema.length(24)

export const bootstrapSchema = z
  .object({
    email: z.string().trim().email().max(200),
    kdfSalt: saltSchema,
    authHash: derivedKeySchema,
    locale: z.enum(['pt-PT', 'en-GB']),
  })
  .strict()

export const loginSchema = z
  .object({
    email: z.string().trim().email().max(200),
    authHash: derivedKeySchema,
  })
  .strict()

export type BootstrapInput = z.infer<typeof bootstrapSchema>
export type LoginInput = z.infer<typeof loginSchema>
