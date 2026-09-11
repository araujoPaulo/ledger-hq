import { deriveMasterKey, deriveStretchedKey, fromBase64, unwrapVaultKey } from '@ledger-hq/crypto'
import { apiFetch } from '../api/client'
import { getVaultEnvelope } from './api'
import { getVaultMeta, putVaultMeta } from './vault-db'
import { unlockVault } from './vault-session'

type KdfResponse = { kdfSalt: string }

export type ResolvedEnvelope = { kdfSalt: string; protectedVaultKey: string; setUp: boolean; fromCache: boolean }

/**
 * Prefers the live server envelope; falls back to the last cached copy when
 * offline (spec 9.6). Returns `null` only when neither is available — the
 * first unlock attempt ever made, offline, before anything was cached.
 */
export async function resolveEnvelope(email: string): Promise<ResolvedEnvelope | null> {
  try {
    const [envelope, kdf] = await Promise.all([
      getVaultEnvelope(),
      apiFetch<KdfResponse>(`/auth/kdf?email=${encodeURIComponent(email)}`),
    ])

    return {
      kdfSalt: kdf.kdfSalt,
      protectedVaultKey: envelope.protectedVaultKey ?? '',
      setUp: envelope.protectedVaultKey !== null,
      fromCache: false,
    }
  } catch {
    const cached = await getVaultMeta()
    if (!cached) return null
    return { kdfSalt: cached.kdfSalt, protectedVaultKey: cached.protectedVaultKey, setUp: true, fromCache: true }
  }
}

/** Throws when the vault was never set up, or when `masterPassword` is wrong (AES-KW's own integrity check). */
export async function unlockWithPassword(email: string, masterPassword: string): Promise<void> {
  const envelope = await resolveEnvelope(email)
  if (!envelope || !envelope.setUp) throw new Error('vault not set up')

  const masterKey = await deriveMasterKey(masterPassword, fromBase64(envelope.kdfSalt))
  const stretched = await deriveStretchedKey(masterKey)
  const sessionKey = await unwrapVaultKey(fromBase64(envelope.protectedVaultKey), stretched)

  unlockVault(sessionKey)

  if (!envelope.fromCache) {
    const existing = await getVaultMeta()
    await putVaultMeta({
      id: 'singleton',
      kdfSalt: envelope.kdfSalt,
      protectedVaultKey: envelope.protectedVaultKey,
      lastSyncedAt: existing?.lastSyncedAt ?? null,
    })
  }
}
