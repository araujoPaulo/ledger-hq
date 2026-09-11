import {
  deriveAuthHash,
  deriveMasterKey,
  deriveRecoveryAuthHash,
  deriveRecoveryWrappingKey,
  deriveStretchedKey,
  fromBase64,
  generateRecoveryCode,
  generateVaultKey,
  importVaultSessionKey,
  toBase64,
  wrapVaultKey,
} from '@ledger-hq/crypto'
import { apiFetch } from '../api/client'
import { postVaultSetup } from './api'
import { putVaultMeta } from './vault-db'
import { unlockVault } from './vault-session'

type KdfResponse = { kdfSalt: string }

export async function setUpVault(email: string, masterPassword: string): Promise<{ recoveryCode: string }> {
  const { kdfSalt } = await apiFetch<KdfResponse>(`/auth/kdf?email=${encodeURIComponent(email)}`)
  const masterKey = await deriveMasterKey(masterPassword, fromBase64(kdfSalt))
  const authHash = toBase64(await deriveAuthHash(masterKey, masterPassword))

  // Verifies the re-typed master password before anything irreversible is
  // generated: a wrong password here would wrap the vault key with a key
  // nothing could ever unwrap again.
  await apiFetch('/auth/login', { method: 'POST', body: { email, authHash } })

  const stretched = await deriveStretchedKey(masterKey)
  const vaultKey = generateVaultKey()
  const recoveryCode = generateRecoveryCode()
  const recoveryWrappingKey = await deriveRecoveryWrappingKey(recoveryCode)

  const protectedVaultKey = await wrapVaultKey(vaultKey, stretched)
  const recoveryVaultKey = await wrapVaultKey(vaultKey, recoveryWrappingKey)
  const recoveryAuthHash = await deriveRecoveryAuthHash(vaultKey, recoveryCode)

  const protectedVaultKeyBase64 = toBase64(protectedVaultKey)

  await postVaultSetup({
    protectedVaultKey: protectedVaultKeyBase64,
    recoveryVaultKey: toBase64(recoveryVaultKey),
    recoveryAuthHash: toBase64(recoveryAuthHash),
  })

  unlockVault(await importVaultSessionKey(vaultKey))
  await putVaultMeta({ id: 'singleton', kdfSalt, protectedVaultKey: protectedVaultKeyBase64, lastSyncedAt: null })

  return { recoveryCode }
}
