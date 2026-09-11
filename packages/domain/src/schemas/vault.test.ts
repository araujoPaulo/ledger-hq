import { describe, expect, it } from 'vitest'
import { recoverVaultSchema, setUpVaultSchema } from './vault'

describe('setUpVaultSchema', () => {
  it('accepts three base64 fields', () => {
    const result = setUpVaultSchema.safeParse({
      protectedVaultKey: 'AAAA',
      recoveryVaultKey: 'AAAA',
      recoveryAuthHash: 'AAAA',
    })
    expect(result.success).toBe(true)
  })
})

describe('recoverVaultSchema', () => {
  it('accepts the reset payload', () => {
    const result = recoverVaultSchema.safeParse({
      recoveryAuthHash: 'AAAA',
      kdfSalt: 'AAAA',
      authHash: 'AAAA',
      protectedVaultKey: 'AAAA',
    })
    expect(result.success).toBe(true)
  })
})
