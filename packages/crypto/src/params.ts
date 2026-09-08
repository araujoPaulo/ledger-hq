/**
 * Vault key derivation. 64 MiB is the safe ceiling for Safari on iPhone;
 * raising it makes the vault fail to open on the phone, which defeats the
 * offline requirement. Do not change without re-testing on a real device.
 */
export const KDF_PARAMS = {
  memorySizeKiB: 65536,
  iterations: 3,
  parallelism: 1,
  hashLengthBytes: 32,
} as const

/**
 * Second, cheaper pass that separates the login credential from the vault key.
 * Its input is already a 32-byte high-entropy key, so it needs far less work
 * than the first pass and must not double the cost of unlocking on mobile.
 */
export const AUTH_HASH_PARAMS = {
  memorySizeKiB: 16384,
  iterations: 1,
  parallelism: 1,
  hashLengthBytes: 32,
} as const

export const VAULT_HKDF_INFO = 'ledger-hq:vault'
