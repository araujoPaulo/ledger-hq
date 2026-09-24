import { describe, expect, it } from 'vitest'
import { appliesTo, generatePeriods, resolveDueDate } from './resolver'
import type { CatalogEntry, ObligationSubject, Period } from './catalog-types'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

function period(start: [number, number, number], end: [number, number, number], label: string): Period {
  return { start: utc(...start), end: utc(...end), label }
}

const companySubject: ObligationSubject = {
  kind: 'COMPANY',
  hasOpenActivity: true,
  vatRegime: 'MONTHLY',
  incomeTax: 'CIT',
  hasEmployees: true,
  hasWithholding: false,
  isVatCashBasis: false,
}

describe('appliesTo', () => {
  it('matches when every condition in "all" is satisfied', () => {
    const definition = {
      appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'COMPANY' }, { field: 'hasEmployees', op: 'eq', value: true }] },
    } as Pick<CatalogEntry, 'appliesWhen'>

    expect(appliesTo(definition as CatalogEntry, companySubject)).toBe(true)
  })

  it('fails when any condition in "all" is not satisfied', () => {
    const definition = {
      appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'INDIVIDUAL' }] },
    } as Pick<CatalogEntry, 'appliesWhen'>

    expect(appliesTo(definition as CatalogEntry, companySubject)).toBe(false)
  })

  it('matches an empty condition list unconditionally', () => {
    const definition = { appliesWhen: { all: [] } } as Pick<CatalogEntry, 'appliesWhen'>
    expect(appliesTo(definition as CatalogEntry, companySubject)).toBe(true)
  })
})

describe('generatePeriods', () => {
  it('MONTHLY: one period per calendar month, label and boundaries correct', () => {
    const periods = generatePeriods('MONTHLY', utc(2026, 1, 1), utc(2026, 2, 28))
    expect(periods).toEqual([
      { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' },
      { start: utc(2026, 2, 1), end: utc(2026, 2, 28), label: '2026-02' },
    ])
  })

  it('MONTHLY: a leap-year February has 29 days', () => {
    const periods = generatePeriods('MONTHLY', utc(2028, 2, 1), utc(2028, 2, 29))
    expect(periods).toEqual([{ start: utc(2028, 2, 1), end: utc(2028, 2, 29), label: '2028-02' }])
  })

  it('QUARTERLY: one period per quarter, label uses the Q-notation', () => {
    const periods = generatePeriods('QUARTERLY', utc(2026, 1, 1), utc(2026, 6, 30))
    expect(periods).toEqual([
      { start: utc(2026, 1, 1), end: utc(2026, 3, 31), label: '2026-Q1' },
      { start: utc(2026, 4, 1), end: utc(2026, 6, 30), label: '2026-Q2' },
    ])
  })

  it('ANNUAL: one period per calendar year', () => {
    const periods = generatePeriods('ANNUAL', utc(2025, 6, 1), utc(2026, 6, 1))
    expect(periods).toEqual([
      { start: utc(2025, 1, 1), end: utc(2025, 12, 31), label: '2025' },
      { start: utc(2026, 1, 1), end: utc(2026, 12, 31), label: '2026' },
    ])
  })

  it('ONE_OFF: never generates a period — ad-hoc obligations are created directly, not swept', () => {
    expect(generatePeriods('ONE_OFF', utc(2026, 1, 1), utc(2026, 12, 31))).toEqual([])
  })
})

describe('resolveDueDate', () => {
  it('dayOfMonthAfterPeriodEnd: no shift needed when the raw date is a business day', () => {
    // Period January 2026, day 20, 2 months after → 20 March 2026 (a Friday).
    const definition = { deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 20, monthsAfter: 2 }, businessDayShift: 'NEXT' } as const
    const p = period([2026, 1, 1], [2026, 1, 31], '2026-01')

    expect(resolveDueDate(definition, p)).toEqual(utc(2026, 3, 20))
  })

  it('dayOfMonthAfterPeriodEnd: shifts a Saturday forward to Monday', () => {
    // 21 March 2026 is a Saturday.
    const definition = { deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 21, monthsAfter: 0 }, businessDayShift: 'NEXT' } as const
    const p = period([2026, 3, 1], [2026, 3, 31], '2026-03')

    expect(resolveDueDate(definition, p)).toEqual(utc(2026, 3, 23))
  })

  it('fixedDate: shifts a date that is both a Saturday and a national holiday', () => {
    // 25 April 2026 (Dia da Liberdade) is a Saturday; next business day is Monday 27 April.
    const definition = { deadline: { kind: 'fixedDate', month: 4, day: 25, yearsAfter: 0 }, businessDayShift: 'NEXT' } as const
    const p = period([2026, 1, 1], [2026, 1, 31], '2026-01')

    expect(resolveDueDate(definition, p)).toEqual(utc(2026, 4, 27))
  })

  it('fixedDate: yearsAfter shifts the deadline to a following year', () => {
    const definition = { deadline: { kind: 'fixedDate', month: 5, day: 31, yearsAfter: 1 }, businessDayShift: 'NEXT' } as const
    const p = period([2025, 1, 1], [2025, 12, 31], '2025')

    // 31 May 2026 is a Sunday; next business day is Monday 1 June 2026.
    expect(resolveDueDate(definition, p)).toEqual(utc(2026, 6, 1))
  })

  it('lastDayOfMonthAfterPeriodEnd: resolves to the actual last day of a short month, not a fixed day-of-month', () => {
    // Period April 2026 (30 days), 2 months after → June 2026, which also
    // has 30 days — chosen so the test cannot pass by coincidentally
    // matching a hardcoded day-of-month like 31.
    const definition = { deadline: { kind: 'lastDayOfMonthAfterPeriodEnd', monthsAfter: 2 }, businessDayShift: 'NEXT' } as const
    const p = period([2026, 4, 1], [2026, 4, 30], '2026-04')

    // 30 June 2026 is a Tuesday — no shift needed.
    expect(resolveDueDate(definition, p)).toEqual(utc(2026, 6, 30))
  })

  it('lastDayOfMonthAfterPeriodEnd: a 31-day target month is not truncated to 30', () => {
    const definition = { deadline: { kind: 'lastDayOfMonthAfterPeriodEnd', monthsAfter: 1 }, businessDayShift: 'NEXT' } as const
    const p = period([2026, 6, 1], [2026, 6, 30], '2026-06')

    // 31 July 2026 is a Friday — no shift needed.
    expect(resolveDueDate(definition, p)).toEqual(utc(2026, 7, 31))
  })
})
