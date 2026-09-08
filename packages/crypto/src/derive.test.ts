import { describe, expect, it } from 'vitest'
import { fromBase64, toBase64 } from './encoding'
import { deriveAuthHash, deriveMasterKey, deriveStretchedKey, generateSalt } from './derive'
import { KDF_PARAMS } from './params'

const PASSWORD = 'correct horse battery staple'
const SALT = fromBase64('AAECAwQFBgcICQoLDA0ODw==')

describe('KDF parameters', () => {
  it('uses 64 MiB, which is the safe ceiling for Safari on iPhone', () => {
    expect(KDF_PARAMS.memorySizeKiB).toBe(65536)
    expect(KDF_PARAMS.iterations).toBe(3)
    expect(KDF_PARAMS.parallelism).toBe(1)
    expect(KDF_PARAMS.hashLengthBytes).toBe(32)
  })
})

describe('generateSalt', () => {
  it('returns 16 random bytes', () => {
    const first = generateSalt()
    const second = generateSalt()

    expect(first).toHaveLength(16)
    expect(toBase64(first)).not.toBe(toBase64(second))
  })
})

describe('deriveMasterKey', () => {
  it('returns 32 bytes', async () => {
    const key = await deriveMasterKey(PASSWORD, SALT)

    expect(key).toHaveLength(32)
  })

  it('is deterministic for the same password and salt', async () => {
    const first = await deriveMasterKey(PASSWORD, SALT)
    const second = await deriveMasterKey(PASSWORD, SALT)

    expect(toBase64(first)).toBe(toBase64(second))
  })

  it('changes with the salt', async () => {
    const first = await deriveMasterKey(PASSWORD, SALT)
    const second = await deriveMasterKey(PASSWORD, generateSalt())

    expect(toBase64(first)).not.toBe(toBase64(second))
  })

  it('changes with the password', async () => {
    const first = await deriveMasterKey(PASSWORD, SALT)
    const second = await deriveMasterKey(`${PASSWORD}!`, SALT)

    expect(toBase64(first)).not.toBe(toBase64(second))
  })

  it('matches the committed snapshot, so a parameter change cannot pass silently', async () => {
    const key = await deriveMasterKey(PASSWORD, SALT)

    expect(toBase64(key)).toMatchSnapshot()
  })
})

describe('deriveStretchedKey', () => {
  it('returns 32 bytes and never equals the master key', async () => {
    const masterKey = await deriveMasterKey(PASSWORD, SALT)
    const stretched = await deriveStretchedKey(masterKey)

    expect(stretched).toHaveLength(32)
    expect(toBase64(stretched)).not.toBe(toBase64(masterKey))
  })
})

describe('deriveAuthHash', () => {
  it('returns 32 bytes and differs from the vault key material', async () => {
    const masterKey = await deriveMasterKey(PASSWORD, SALT)
    const stretched = await deriveStretchedKey(masterKey)
    const authHash = await deriveAuthHash(masterKey, PASSWORD)

    expect(authHash).toHaveLength(32)
    expect(toBase64(authHash)).not.toBe(toBase64(stretched))
    expect(toBase64(authHash)).not.toBe(toBase64(masterKey))
  })

  it('is deterministic', async () => {
    const masterKey = await deriveMasterKey(PASSWORD, SALT)

    expect(toBase64(await deriveAuthHash(masterKey, PASSWORD))).toBe(
      toBase64(await deriveAuthHash(masterKey, PASSWORD)),
    )
  })
})

describe('base64 round trip', () => {
  it('preserves bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255])

    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes))
  })
})
