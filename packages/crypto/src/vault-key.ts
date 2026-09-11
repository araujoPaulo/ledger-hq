import { type Bytes, toBase32, utf8 } from './encoding'
import { RECOVERY_HKDF_INFO } from './params'

/** A fresh 256-bit key, wrapped separately for the master password and the recovery code. */
export function generateVaultKey(): Bytes {
  return crypto.getRandomValues(new Uint8Array(32))
}

/**
 * 128 random bits, formatted for paper transcription. 16 bytes base32-encode
 * to 26 characters, which does not divide evenly into groups — the last
 * group is short, which is fine; it is still exactly 128 bits of entropy.
 */
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return (toBase32(bytes).match(/.{1,5}/g) ?? []).join('-')
}

function importWrappingKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-KW', false, ['wrapKey', 'unwrapKey'])
}

/** Wraps a freshly generated vault key so it can be persisted server-side. */
export async function wrapVaultKey(vaultKey: Bytes, wrappingKey: Bytes): Promise<Bytes> {
  const extractableKey = await crypto.subtle.importKey(
    'raw',
    vaultKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
  const wrapper = await importWrappingKey(wrappingKey)
  const wrapped = await crypto.subtle.wrapKey('raw', extractableKey, wrapper, 'AES-KW')
  return new Uint8Array(wrapped)
}

/**
 * Unwraps a stored envelope directly into a non-extractable session key: the
 * raw vault key bytes never exist in JavaScript at unlock time. AES-KW's
 * built-in integrity check means a wrong `wrappingKey` makes this reject
 * with an error — the offline "wrong master password" signal, with no
 * server round-trip and no test credential required.
 */
export async function unwrapVaultKey(wrapped: Bytes, wrappingKey: Bytes): Promise<CryptoKey> {
  const wrapper = await importWrappingKey(wrappingKey)
  return crypto.subtle.unwrapKey(
    'raw',
    wrapped,
    wrapper,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Same non-extractable import, used right after `generateVaultKey` during setup. */
export function importVaultSessionKey(vaultKey: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', vaultKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/**
 * Unwraps to raw bytes rather than a session `CryptoKey` — the one
 * deliberate exception to "the vault key is never extractable" (see Global
 * Constraints). Recovery (Task 14) needs the raw key twice: to recompute
 * `deriveRecoveryAuthHash` for the server to verify, and to `wrapVaultKey`
 * it again under the new master password. Nothing outside the recovery flow
 * calls this; every other path uses `unwrapVaultKey` above.
 */
export async function unwrapVaultKeyRaw(wrapped: Bytes, wrappingKey: Bytes): Promise<Bytes> {
  const wrapper = await importWrappingKey(wrappingKey)
  const extractableKey = await crypto.subtle.unwrapKey(
    'raw',
    wrapped,
    wrapper,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
  const raw = await crypto.subtle.exportKey('raw', extractableKey)
  return new Uint8Array(raw)
}

/** HKDF expansion of the recovery code into the key that wraps the second envelope copy. */
export async function deriveRecoveryWrappingKey(recoveryCode: string): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', utf8(recoveryCode), 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: utf8(RECOVERY_HKDF_INFO) },
    key,
    256,
  )
  return new Uint8Array(bits)
}
