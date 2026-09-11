import { describe, expect, it } from 'vitest'
import { createCredentialSchema, credentialItemSchema, rotateCredentialSchema, syncCredentialsQuerySchema } from './credential'

const uuid = '01927e6a-0000-7000-8000-000000000000'

describe('createCredentialSchema', () => {
  it('accepts a well-formed credential', () => {
    const result = createCredentialSchema.safeParse({
      clientId: uuid,
      platformId: uuid,
      label: 'Acesso principal',
      ciphertext: 'AAAA',
      iv: 'AAAA',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-base64 ciphertext', () => {
    const result = createCredentialSchema.safeParse({
      clientId: uuid,
      platformId: uuid,
      label: 'x',
      ciphertext: 'not base64!!',
      iv: 'AAAA',
    })
    expect(result.success).toBe(false)
  })
})

describe('rotateCredentialSchema', () => {
  it('accepts just ciphertext and iv', () => {
    expect(rotateCredentialSchema.safeParse({ ciphertext: 'AAAA', iv: 'AAAA' }).success).toBe(true)
  })
})

describe('syncCredentialsQuerySchema', () => {
  it('accepts an absent since', () => {
    expect(syncCredentialsQuerySchema.safeParse({}).success).toBe(true)
  })

  it('accepts a valid UTC instant', () => {
    expect(syncCredentialsQuerySchema.safeParse({ since: '2026-09-10T12:00:00.000Z' }).success).toBe(true)
  })

  it('rejects a bare date', () => {
    expect(syncCredentialsQuerySchema.safeParse({ since: '2026-09-10' }).success).toBe(false)
  })
})

describe('credentialItemSchema', () => {
  it('accepts the full shape from spec 9.3', () => {
    const result = credentialItemSchema.safeParse({
      username: '509123456',
      password: 'hunter2',
      accessPin: '1234',
      totpSecret: 'JBSWY3DP',
      extraFields: [{ label: 'Senha de acesso SS', value: 'x' }],
      notes: 'Certified accountant access',
    })
    expect(result.success).toBe(true)
  })

  it('accepts an empty item', () => {
    expect(credentialItemSchema.safeParse({}).success).toBe(true)
  })
})
