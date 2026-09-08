import { argon2id } from 'hash-wasm'
import { type Bytes, utf8 } from './encoding'
import { AUTH_HASH_PARAMS, KDF_PARAMS, VAULT_HKDF_INFO } from './params'

type Argon2Params = {
  readonly memorySizeKiB: number
  readonly iterations: number
  readonly parallelism: number
  readonly hashLengthBytes: number
}

async function argon2(password: Bytes, salt: Bytes, params: Argon2Params): Promise<Bytes> {
  // hash-wasm returns Uint8Array<ArrayBufferLike>; copy into an
  // ArrayBuffer-backed array so the result satisfies BufferSource.
  const hash = await argon2id({
    password,
    salt,
    memorySize: params.memorySizeKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: params.hashLengthBytes,
    outputType: 'binary',
  })

  return new Uint8Array(hash)
}

export function generateSalt(): Bytes {
  return crypto.getRandomValues(new Uint8Array(16))
}

/** Argon2id over the master password. The result never leaves the device. */
export function deriveMasterKey(masterPassword: string, salt: Bytes): Promise<Bytes> {
  return argon2(utf8(masterPassword), salt, KDF_PARAMS)
}

/** HKDF expansion that produces the key wrapping the vault key. */
export async function deriveStretchedKey(masterKey: Bytes): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', masterKey, 'HKDF', false, ['deriveBits'])

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: utf8(VAULT_HKDF_INFO),
    },
    key,
    256,
  )

  return new Uint8Array(bits)
}

/**
 * The only derivative that travels to the server. Salting with the password
 * itself is what makes this branch uninvertible into the vault key.
 */
export function deriveAuthHash(masterKey: Bytes, masterPassword: string): Promise<Bytes> {
  return argon2(masterKey, utf8(masterPassword), AUTH_HASH_PARAMS)
}
