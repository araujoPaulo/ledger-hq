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

/**
 * Distinct from `VAULT_HKDF_INFO`: this expands the recovery *code* (not the
 * master password) into the key that wraps the second copy of the vault key.
 */
export const RECOVERY_HKDF_INFO = 'ledger-hq:vault-recovery'

/**
 * `deriveAuthHash` passes the raw master password's UTF-8 bytes as the
 * Argon2id salt for the second derivation pass, and Argon2 implementations
 * (including the `hash-wasm` build used here) throw if a salt is under 8
 * bytes — so an unconstrained short password crashes derivation outright.
 * 12 is comfortably above that technical floor and a reasonable minimum for
 * the one credential this whole zero-knowledge design depends on, with no
 * password-reset path. Consumers (`SetupPage`, `LoginPage`, ...) must
 * enforce this themselves, client-side, before calling any derivation
 * function — this package only owns the number, not the enforcement.
 */
export const MIN_MASTER_PASSWORD_LENGTH = 12
