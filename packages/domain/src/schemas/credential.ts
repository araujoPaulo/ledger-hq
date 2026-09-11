import { z } from 'zod'
import { base64Schema, uuidSchema } from './common'

export const createCredentialSchema = z
  .object({
    clientId: uuidSchema,
    platformId: uuidSchema,
    label: z.string().trim().min(1).max(200),
    ciphertext: base64Schema,
    iv: base64Schema,
  })
  .strict()

export const rotateCredentialSchema = z
  .object({
    ciphertext: base64Schema,
    iv: base64Schema,
  })
  .strict()

/**
 * `since` as a strict UTC ISO-8601 instant, matching how `updatedAt` columns
 * serialise. A plain regex rather than a datetime-format keyword, to stay on
 * the validation style already used for `isoDateSchema` in `./common`.
 */
export const syncCredentialsQuerySchema = z
  .object({
    since: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
      .optional(),
  })
  .strict()

export type SyncCredentialsQuery = z.infer<typeof syncCredentialsQuerySchema>

/**
 * The plaintext shape a credential item decrypts to (spec 9.3). Never sent
 * to the server — validated client-side before encryption, and used as the
 * shared type between the vault UI's form and `encryptCredentialItem`.
 */
export const credentialItemSchema = z
  .object({
    username: z.string().trim().max(200).optional(),
    password: z.string().max(500).optional(),
    accessPin: z.string().max(50).optional(),
    totpSecret: z.string().trim().max(200).optional(),
    extraFields: z.array(z.object({ label: z.string().trim().min(1).max(100), value: z.string().max(500) })).max(20).optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict()

export type CreateCredentialInput = z.infer<typeof createCredentialSchema>
export type RotateCredentialInput = z.infer<typeof rotateCredentialSchema>
export type CredentialItem = z.infer<typeof credentialItemSchema>
