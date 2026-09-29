import { describe, expect, it } from 'vitest'
import { atRiskQuerySchema } from './reporting'

describe('atRiskQuerySchema', () => {
  it('accepts an ISO date', () => {
    expect(atRiskQuerySchema.parse({ asOf: '2026-09-29' })).toEqual({ asOf: '2026-09-29' })
  })

  it('accepts no date at all — the caller defaults to today', () => {
    expect(atRiskQuerySchema.parse({})).toEqual({})
  })

  it('rejects a non-ISO date', () => {
    expect(atRiskQuerySchema.safeParse({ asOf: '29/09/2026' }).success).toBe(false)
  })

  it('rejects unknown keys', () => {
    expect(atRiskQuerySchema.safeParse({ asOf: '2026-09-29', limit: 5 }).success).toBe(false)
  })
})
