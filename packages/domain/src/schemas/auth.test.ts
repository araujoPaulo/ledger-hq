import { describe, expect, it } from 'vitest'
import { bootstrapSchema, kdfQuerySchema, loginSchema } from './auth'

const validAuthHash = 'A'.repeat(43) + '='
const validKdfSalt = 'A'.repeat(22) + '=='

describe('bootstrapSchema', () => {
  it('lower-cases the email', () => {
    const result = bootstrapSchema.safeParse({
      email: 'Paulo@Example.com',
      kdfSalt: validKdfSalt,
      authHash: validAuthHash,
      locale: 'pt-PT',
    })

    expect(result.success).toBe(true)
    expect(result.success && result.data.email).toBe('paulo@example.com')
  })
})

describe('loginSchema', () => {
  it('lower-cases the email', () => {
    const result = loginSchema.safeParse({ email: 'Paulo@Example.com', authHash: validAuthHash })

    expect(result.success).toBe(true)
    expect(result.success && result.data.email).toBe('paulo@example.com')
  })
})

describe('kdfQuerySchema', () => {
  it('trims and lower-cases a plain email string', () => {
    const result = kdfQuerySchema.safeParse({ email: '  Paulo@Example.com  ' })

    expect(result.success).toBe(true)
    expect(result.success && result.data.email).toBe('paulo@example.com')
  })

  it('does not require email-shaped input, so a garbled address still reaches the decoy path', () => {
    expect(kdfQuerySchema.safeParse({ email: 'not-an-email' }).success).toBe(true)
  })

  it('rejects a query value that is not a plain string, such as ?email[]=x', () => {
    expect(kdfQuerySchema.safeParse({ email: ['x'] }).success).toBe(false)
    expect(kdfQuerySchema.safeParse({ email: { a: 'x' } }).success).toBe(false)
  })
})
