import type { Bytes } from './encoding'

/** AES-256-GCM with a fresh random 96-bit IV, never reused across items or versions. */
export async function encryptCredentialItem(
  vaultKey: CryptoKey,
  item: Record<string, unknown>,
): Promise<{ ciphertext: Bytes; iv: Bytes }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(item))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey, plaintext)
  return { ciphertext: new Uint8Array(encrypted), iv }
}

/**
 * Throws if `vaultKey` is wrong or `ciphertext`/`iv` were tampered with: GCM's
 * authentication tag makes a bad key or altered bytes produce a rejected
 * decryption instead of garbage plaintext.
 */
export async function decryptCredentialItem(
  vaultKey: CryptoKey,
  ciphertext: Bytes,
  iv: Bytes,
): Promise<Record<string, unknown>> {
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, vaultKey, ciphertext)
  return JSON.parse(new TextDecoder().decode(decrypted)) as Record<string, unknown>
}
