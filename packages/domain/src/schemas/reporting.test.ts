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

import { periodSummaryQuerySchema } from './reporting'

describe('periodSummaryQuerySchema', () => {
  it('accepts a window', () => {
    expect(periodSummaryQuerySchema.parse({ from: '2026-01-01', to: '2026-03-31' })).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
    })
  })

  it('accepts a single-day window', () => {
    expect(periodSummaryQuerySchema.safeParse({ from: '2026-01-01', to: '2026-01-01' }).success).toBe(true)
  })

  it('rejects a window that ends before it starts', () => {
    expect(periodSummaryQuerySchema.safeParse({ from: '2026-03-31', to: '2026-01-01' }).success).toBe(false)
  })

  it('requires both ends', () => {
    expect(periodSummaryQuerySchema.safeParse({ from: '2026-01-01' }).success).toBe(false)
    expect(periodSummaryQuerySchema.safeParse({ to: '2026-03-31' }).success).toBe(false)
  })
})
