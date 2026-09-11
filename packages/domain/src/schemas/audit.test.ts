import { describe, expect, it } from 'vitest'
import { createAuditEventSchema } from './audit'

describe('createAuditEventSchema', () => {
  it('accepts a credential-reveal event', () => {
    const result = createAuditEventSchema.safeParse({
      entityType: 'credential',
      entityId: 'c1',
      action: 'credential.revealed',
      metadata: {},
    })
    expect(result.success).toBe(true)
  })

  it('defaults metadata to an empty object', () => {
    const result = createAuditEventSchema.parse({ entityType: 'credential', entityId: 'c1', action: 'x' })
    expect(result.metadata).toEqual({})
  })
})
