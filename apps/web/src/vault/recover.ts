import {
  deriveAuthHash,
  deriveMasterKey,
  deriveRecoveryAuthHash,
  deriveRecoveryWrappingKey,
  deriveStretchedKey,
  fromBase64,
  generateSalt,
  importVaultSessionKey,
  toBase64,
  unwrapVaultKeyRaw,
  wrapVaultKey,
} from '@ledger-hq/crypto'
import { apiFetch } from '../api/client'
import { postVaultRecover } from './api'
import { putVaultMeta } from './vault-db'
import { unlockVault } from './vault-session'

type RecoveryEnvelopeResponse = { recoveryVaultKey: string | null }

/**
 * Regains access with only the recovery code — no session, no old master
 * password. `unwrapVaultKeyRaw` throws first (AES-KW's own integrity check)
 * when the code is wrong, before this ever reaches the server; the server
 * verifies independently too (see `AuthService.recoverVault`, Task 6),
 * because a client-side check alone is never the actual guarantee.
 */
export async function recoverVault(newMasterPassword: string, recoveryCode: string): Promise<void> {
  const { recoveryVaultKey } = await apiFetch<RecoveryEnvelopeResponse>('/auth/vault-recovery-envelope')
  if (recoveryVaultKey === null) throw new Error('vault not set up')

  const recoveryWrappingKey = await deriveRecoveryWrappingKey(recoveryCode)
  const vaultKey = await unwrapVaultKeyRaw(fromBase64(recoveryVaultKey), recoveryWrappingKey)
  const recoveryAuthHash = toBase64(await deriveRecoveryAuthHash(vaultKey, recoveryCode))

  const kdfSalt = toBase64(generateSalt())
  const masterKey = await deriveMasterKey(newMasterPassword, fromBase64(kdfSalt))
  const authHash = toBase64(await deriveAuthHash(masterKey, newMasterPassword))
  const stretched = await deriveStretchedKey(masterKey)
  const protectedVaultKey = toBase64(await wrapVaultKey(vaultKey, stretched))

  await postVaultRecover({ recoveryAuthHash, kdfSalt, authHash, protectedVaultKey })

  unlockVault(await importVaultSessionKey(vaultKey))
  await putVaultMeta({ id: 'singleton', kdfSalt, protectedVaultKey, lastSyncedAt: null })
}
