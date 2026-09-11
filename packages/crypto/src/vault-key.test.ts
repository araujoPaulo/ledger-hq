import { describe, expect, it } from 'vitest'
import {
  deriveRecoveryWrappingKey,
  generateRecoveryCode,
  generateVaultKey,
  importVaultSessionKey,
  unwrapVaultKey,
  unwrapVaultKeyRaw,
  wrapVaultKey,
} from './vault-key'
import { encryptCredentialItem, decryptCredentialItem } from './item'

describe('vault key envelope', () => {
  it('unwraps back to a key that decrypts what the original key encrypted', async () => {
    const vaultKey = generateVaultKey()
    const wrappingKey = crypto.getRandomValues(new Uint8Array(32))
    const sessionKey = await importVaultSessionKey(vaultKey)

    const wrapped = await wrapVaultKey(vaultKey, wrappingKey)
    const unwrapped = await unwrapVaultKey(wrapped, wrappingKey)

    const { ciphertext, iv } = await encryptCredentialItem(sessionKey, { password: 'hunter2' })
    await expect(decryptCredentialItem(unwrapped, ciphertext, iv)).resolves.toEqual({ password: 'hunter2' })
  })

  it('rejects unwrapping with the wrong wrapping key', async () => {
    const vaultKey = generateVaultKey()
    const wrapped = await wrapVaultKey(vaultKey, crypto.getRandomValues(new Uint8Array(32)))

    await expect(unwrapVaultKey(wrapped, crypto.getRandomValues(new Uint8Array(32)))).rejects.toThrow()
  })

  it('produces a session key from unwrapVaultKey that cannot be exported', async () => {
    const vaultKey = generateVaultKey()
    const wrappingKey = crypto.getRandomValues(new Uint8Array(32))
    const wrapped = await wrapVaultKey(vaultKey, wrappingKey)
    const unwrapped = await unwrapVaultKey(wrapped, wrappingKey)

    expect(unwrapped.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', unwrapped)).rejects.toThrow()
  })

  it('unwrapVaultKeyRaw recovers the exact original bytes', async () => {
    const vaultKey = generateVaultKey()
    const wrappingKey = crypto.getRandomValues(new Uint8Array(32))
    const wrapped = await wrapVaultKey(vaultKey, wrappingKey)

    await expect(unwrapVaultKeyRaw(wrapped, wrappingKey)).resolves.toEqual(vaultKey)
  })

  it('derives the same recovery wrapping key from the same recovery code', async () => {
    const code = generateRecoveryCode()
    const a = await deriveRecoveryWrappingKey(code)
    const b = await deriveRecoveryWrappingKey(code)
    expect(a).toEqual(b)
  })

  it('generates a recovery code with 26 base32 characters of entropy', () => {
    const code = generateRecoveryCode()
    expect(code.replace(/-/g, '')).toMatch(/^[A-Z2-7]{26}$/)
  })
})
