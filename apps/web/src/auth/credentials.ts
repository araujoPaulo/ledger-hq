import { deriveAuthHash, deriveMasterKey, fromBase64, generateSalt, toBase64 } from '@ledger-hq/crypto'
import { apiFetch } from '../api/client'

type KdfResponse = { kdfSalt: string }

/**
 * Derives the only credential the server ever sees. The master password stays
 * in this function's scope: it is never returned, stored or logged.
 */
export async function deriveAuthCredentials(
  email: string,
  masterPassword: string,
): Promise<{ authHash: string }> {
  const { kdfSalt } = await apiFetch<KdfResponse>(`/auth/kdf?email=${encodeURIComponent(email)}`)

  const masterKey = await deriveMasterKey(masterPassword, fromBase64(kdfSalt))

  return { authHash: toBase64(await deriveAuthHash(masterKey, masterPassword)) }
}

export async function createAccount(
  email: string,
  masterPassword: string,
  locale: 'pt-PT' | 'en-GB',
): Promise<void> {
  const kdfSalt = toBase64(generateSalt())
  const masterKey = await deriveMasterKey(masterPassword, fromBase64(kdfSalt))
  const authHash = toBase64(await deriveAuthHash(masterKey, masterPassword))

  await apiFetch('/auth/bootstrap', {
    method: 'POST',
    body: { email, kdfSalt, authHash, locale },
  })
}

export async function signIn(email: string, masterPassword: string): Promise<void> {
  const { authHash } = await deriveAuthCredentials(email, masterPassword)

  await apiFetch('/auth/login', { method: 'POST', body: { email, authHash } })
}

export async function signOut(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' })
}
