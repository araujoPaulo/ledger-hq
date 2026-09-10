import { describe, expect, it } from 'vitest'
import { createPlatformSchema } from './platform'

describe('createPlatformSchema', () => {
  it('accepts a minimal platform', () => {
    const result = createPlatformSchema.safeParse({ name: 'Portal das Finanças', authKind: 'PASSWORD' })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid URL', () => {
    const result = createPlatformSchema.safeParse({ name: 'X', authKind: 'PASSWORD', url: 'not a url' })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown authKind', () => {
    const result = createPlatformSchema.safeParse({ name: 'X', authKind: 'FINGERPRINT' })
    expect(result.success).toBe(false)
  })
})
