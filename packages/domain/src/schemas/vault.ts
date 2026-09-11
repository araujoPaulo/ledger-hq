import { z } from 'zod'
import { base64Schema } from './common'

export const setUpVaultSchema = z
  .object({
    protectedVaultKey: base64Schema,
    recoveryVaultKey: base64Schema,
    recoveryAuthHash: base64Schema,
  })
  .strict()

export const recoverVaultSchema = z
  .object({
    recoveryAuthHash: base64Schema,
    kdfSalt: base64Schema,
    authHash: base64Schema,
    protectedVaultKey: base64Schema,
  })
  .strict()

export type SetUpVaultInput = z.infer<typeof setUpVaultSchema>
export type RecoverVaultInput = z.infer<typeof recoverVaultSchema>
