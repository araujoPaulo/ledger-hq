import { describe, expect, it } from 'vitest'
import { decryptCredentialItem, encryptCredentialItem } from './item'

describe('credential item encryption', () => {
  it('round-trips arbitrary JSON-serialisable content', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const item = { username: '509123456', password: 'hunter2', extraFields: [{ label: 'PIN', value: '1234' }] }

    const { ciphertext, iv } = await encryptCredentialItem(key, item)
    await expect(decryptCredentialItem(key, ciphertext, iv)).resolves.toEqual(item)
  })

  it('uses a fresh IV on every call', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const a = await encryptCredentialItem(key, { password: 'x' })
    const b = await encryptCredentialItem(key, { password: 'x' })
    expect(a.iv).not.toEqual(b.iv)
  })

  it('rejects decryption when a ciphertext byte is flipped', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const { ciphertext, iv } = await encryptCredentialItem(key, { password: 'x' })
    const tampered = new Uint8Array(ciphertext)
    if (tampered[0] !== undefined) tampered[0] ^= 0xff

    await expect(decryptCredentialItem(key, tampered, iv)).rejects.toThrow()
  })

  it('rejects decryption with the wrong key', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const otherKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const { ciphertext, iv } = await encryptCredentialItem(key, { password: 'x' })

    await expect(decryptCredentialItem(otherKey, ciphertext, iv)).rejects.toThrow()
  })
})
