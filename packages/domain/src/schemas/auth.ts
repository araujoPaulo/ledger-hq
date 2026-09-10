import { z } from 'zod'
import { base64Schema } from './common'

/** 32 bytes, base64: 43 characters plus one '=' of padding. */
const derivedKeySchema = base64Schema.length(44)

/** 16 bytes, base64: 22 characters plus two '=' of padding. */
const saltSchema = base64Schema.length(24)

/**
 * Lower-cased so a bootstrap or login with a different-case address does not
 * silently create or look up a distinct account: `User.email` is a
 * case-sensitive unique column, and with no password reset a case mismatch
 * would otherwise lock the account's owner out permanently.
 */
const emailSchema = z.string().trim().toLowerCase().email().max(200)

export const bootstrapSchema = z
  .object({
    email: emailSchema,
    kdfSalt: saltSchema,
    authHash: derivedKeySchema,
    locale: z.enum(['pt-PT', 'en-GB']),
  })
  .strict()

export const loginSchema = z
  .object({
    email: emailSchema,
    authHash: derivedKeySchema,
  })
  .strict()

/**
 * `GET /auth/kdf` must never throw on a malformed query: the endpoint's
 * whole purpose is to answer indistinguishably for any address, real or not.
 * This only guards against a shape a plain string lookup can't handle (e.g.
 * `?email[]=x`, which Express's query parser turns into an array) — it does
 * not require email-shaped input, so a garbled address still falls through
 * to the ordinary decoy-salt path instead of a validation error.
 */
export const kdfQuerySchema = z
  .object({
    email: z.string().trim().toLowerCase().max(200),
  })
  .strict()

export type BootstrapInput = z.infer<typeof bootstrapSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type KdfQuery = z.infer<typeof kdfQuerySchema>
