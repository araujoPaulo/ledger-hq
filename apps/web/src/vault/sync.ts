import { listPlatforms, syncCredentials } from './api'
import { getVaultMeta, putCachedCredentials, putCachedPlatforms, putVaultMeta } from './vault-db'

/**
 * Refreshes the IndexedDB cache: the current platform catalog in full (it is
 * small and plaintext, spec 6.4), and every credential changed since the
 * last successful sync (spec 9.6's cursor). Only ciphertext and metadata
 * ever pass through here — nothing is decrypted, so this needs no unlocked
 * vault key at all.
 */
export async function syncVault(): Promise<void> {
  const meta = await getVaultMeta()

  const platforms = await listPlatforms()
  await putCachedPlatforms(platforms.map((platform) => ({ ...platform })))

  const credentials = await syncCredentials(meta?.lastSyncedAt ?? null)
  await putCachedCredentials(credentials.map((credential) => ({ ...credential })))

  if (meta) {
    await putVaultMeta({ ...meta, lastSyncedAt: new Date().toISOString() })
  }
}
