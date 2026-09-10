import { describe, expect, it } from 'vitest'
import { formatCurrency, formatDate, formatLongDate, formatQuarter } from './format'

/** Intl inserts non-breaking and narrow spaces; normalise before comparing. */
function normalise(value: string): string {
  return value.replace(/[\u00A0\u202F]/g, ' ')
}

describe('formatDate', () => {
  it('uses day-first ordering in both locales', () => {
    expect(formatDate('2026-09-04', 'pt-PT')).toBe('04/09/2026')
    expect(formatDate('2026-09-04', 'en-GB')).toBe('04/09/2026')
  })
})

describe('formatLongDate', () => {
  it('spells the month in the active language', () => {
    expect(normalise(formatLongDate('2026-09-04', 'pt-PT'))).toContain('setembro')
    expect(normalise(formatLongDate('2026-09-04', 'en-GB'))).toContain('September')
  })
})

describe('formatCurrency', () => {
  it('renders euros from integer cents', () => {
    expect(normalise(formatCurrency(123456, 'pt-PT'))).toBe('1 234,56 €')
    expect(normalise(formatCurrency(123456, 'en-GB'))).toBe('€1,234.56')
  })

  it('handles zero and negative amounts', () => {
    expect(normalise(formatCurrency(0, 'pt-PT'))).toBe('0,00 €')
    expect(normalise(formatCurrency(-500, 'en-GB'))).toBe('-€5.00')
  })
})

describe('formatQuarter', () => {
  it('renders period labels idiomatically', () => {
    expect(formatQuarter('2026-Q1', 'pt-PT')).toBe('1.º trimestre de 2026')
    expect(formatQuarter('2026-Q1', 'en-GB')).toBe('Q1 2026')
  })
})
