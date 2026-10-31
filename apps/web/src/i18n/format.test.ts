import { describe, expect, it } from 'vitest'
import { formatAmount, formatCurrency, formatDate, formatLongDate, formatQuarter, parseAmount } from './format'

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

describe('parseAmount', () => {
  it('reads pt-PT amounts with a comma as the decimal mark', () => {
    expect(parseAmount('2150', 'pt-PT')).toBe(215000)
    expect(parseAmount('2150,5', 'pt-PT')).toBe(215050)
    expect(parseAmount('2150,05', 'pt-PT')).toBe(215005)
    expect(parseAmount('0,99', 'pt-PT')).toBe(99)
  })

  it('accepts pt-PT thousands grouping by dot or space', () => {
    expect(parseAmount('2.150,00', 'pt-PT')).toBe(215000)
    expect(parseAmount('1.234.567,89', 'pt-PT')).toBe(123456789)
    expect(parseAmount('2 150,50', 'pt-PT')).toBe(215050)
    expect(parseAmount('2\u00a0150,50', 'pt-PT')).toBe(215050)
    expect(parseAmount('2\u202f150,50', 'pt-PT')).toBe(215050)
    expect(parseAmount('1 234 567,89', 'pt-PT')).toBe(123456789)
    expect(parseAmount('2 150,50 €', 'pt-PT')).toBe(215050)
  })

  // Space is pt-PT's real grouping mark: it follows the same groups-of-three rule.
  it('refuses a space that is not between groups of three digits', () => {
    expect(parseAmount('15 00', 'pt-PT')).toBeNull()
    expect(parseAmount('10 0', 'pt-PT')).toBeNull()
    expect(parseAmount('1 0 0 0', 'pt-PT')).toBeNull()
    expect(parseAmount('21 50,00', 'pt-PT')).toBeNull()
    expect(parseAmount('15\u00a000', 'pt-PT')).toBeNull()
    expect(parseAmount('15\u202f00', 'pt-PT')).toBeNull()
    expect(parseAmount('15 00', 'en-GB')).toBeNull()
    expect(parseAmount('2 150,5 0', 'pt-PT')).toBeNull()
  })

  it('reads en-GB amounts with a dot as the decimal mark', () => {
    expect(parseAmount('2150.00', 'en-GB')).toBe(215000)
    expect(parseAmount('2,150.00', 'en-GB')).toBe(215000)
    expect(parseAmount('2,150', 'en-GB')).toBe(215000)
  })

  // Review Focus 1: a decimal typed with the other locale's mark is refused,
  // never read as an amount a hundred times larger.
  it('refuses a grouping separator that does not sit between groups of three', () => {
    expect(parseAmount('2150.50', 'pt-PT')).toBeNull()
    expect(parseAmount('1.5', 'pt-PT')).toBeNull()
    expect(parseAmount('21.50,00', 'pt-PT')).toBeNull()
    expect(parseAmount('2,15', 'en-GB')).toBeNull()
  })

  it('refuses more than two decimals', () => {
    expect(parseAmount('2.150', 'en-GB')).toBeNull()
    expect(parseAmount('10,001', 'pt-PT')).toBeNull()
  })

  it('refuses signs, letters, a second decimal mark and a bare decimal mark', () => {
    expect(parseAmount('-10', 'pt-PT')).toBeNull()
    expect(parseAmount('+10', 'pt-PT')).toBeNull()
    expect(parseAmount('10a', 'pt-PT')).toBeNull()
    expect(parseAmount('1e3', 'en-GB')).toBeNull()
    expect(parseAmount('1,2,3', 'pt-PT')).toBeNull()
    expect(parseAmount('10,', 'pt-PT')).toBeNull()
    expect(parseAmount(',50', 'pt-PT')).toBeNull()
  })

  it('treats empty and whitespace-only text as no amount', () => {
    expect(parseAmount('', 'pt-PT')).toBeNull()
    expect(parseAmount('   ', 'en-GB')).toBeNull()
  })

  it('strips surrounding whitespace and a euro sign at either end', () => {
    expect(parseAmount('  90,00 ', 'pt-PT')).toBe(9000)
    expect(parseAmount('90,00 €', 'pt-PT')).toBe(9000)
    expect(parseAmount('€90.00', 'en-GB')).toBe(9000)
  })

  it('refuses an amount past the safe integer range', () => {
    expect(parseAmount('999999999999999999', 'pt-PT')).toBeNull()
  })

  it('round-trips with formatCurrency and formatAmount', () => {
    for (const locale of ['pt-PT', 'en-GB'] as const) {
      for (const cents of [0, 1, 99, 100, 9000, 215000, 123456789]) {
        expect(parseAmount(formatCurrency(cents, locale), locale)).toBe(cents)
        expect(parseAmount(formatAmount(cents, locale), locale)).toBe(cents)
      }
    }
  })
})

describe('formatAmount', () => {
  it('groups in the locale, with two decimals and no symbol', () => {
    expect(normalise(formatAmount(215000, 'pt-PT'))).toBe('2 150,00')
    expect(formatAmount(215000, 'en-GB')).toBe('2,150.00')
    expect(formatAmount(5, 'pt-PT')).toBe('0,05')
  })
})
