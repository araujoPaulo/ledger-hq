import { describe, expect, it } from 'vitest'
import { chargeDueDate, chargePeriodsSince } from './periods'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

describe('chargePeriodsSince', () => {
  it('MONTHLY: one period per elapsed month, none in the future', () => {
    const periods = chargePeriodsSince('MONTHLY', utc(2026, 1, 1), utc(2026, 3, 18))
    expect(periods.map((p) => p.label)).toEqual(['2026-01', '2026-02', '2026-03'])
    // March's period starts 1 March, before asOf's 18 March — it has begun,
    // so it's included even though the month itself isn't over.
    expect(periods[2]!.start).toEqual(utc(2026, 3, 1))
  })

  it('MONTHLY: a plan starting mid-month begins counting from that month', () => {
    const periods = chargePeriodsSince('MONTHLY', utc(2026, 2, 15), utc(2026, 4, 1))
    expect(periods.map((p) => p.label)).toEqual(['2026-02', '2026-03', '2026-04'])
  })

  it('QUARTERLY: labels and quarter boundaries', () => {
    const periods = chargePeriodsSince('QUARTERLY', utc(2026, 1, 1), utc(2026, 8, 1))
    expect(periods.map((p) => p.label)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3'])
    expect(periods[1]!.start).toEqual(utc(2026, 4, 1))
  })

  it('ANNUAL: one period per elapsed year', () => {
    const periods = chargePeriodsSince('ANNUAL', utc(2024, 6, 1), utc(2026, 1, 1))
    // A plan starting mid-2024 has its first annual period begin at the
    // start of the quarter/month it was created in for MONTHLY/QUARTERLY,
    // but ANNUAL periods align to calendar years regardless of validFrom's
    // month — the plan's first full or partial year is still "2024".
    expect(periods.map((p) => p.label)).toEqual(['2024', '2025', '2026'])
  })

  it('excludes a period that has not started yet', () => {
    const periods = chargePeriodsSince('MONTHLY', utc(2026, 1, 1), utc(2026, 1, 31))
    expect(periods.map((p) => p.label)).toEqual(['2026-01'])
  })

  it('returns nothing when validFrom is after asOf', () => {
    const periods = chargePeriodsSince('MONTHLY', utc(2026, 5, 1), utc(2026, 3, 1))
    expect(periods).toEqual([])
  })
})

describe('chargeDueDate', () => {
  it('places the due date on the given day of the period start month', () => {
    expect(chargeDueDate(utc(2026, 3, 1), 8)).toEqual(utc(2026, 3, 8))
  })

  it('clamps to the last day of a short month', () => {
    // February 2026 (not a leap year) has 28 days.
    expect(chargeDueDate(utc(2026, 2, 1), 30)).toEqual(utc(2026, 2, 28))
  })

  it('clamps correctly in a leap February', () => {
    expect(chargeDueDate(utc(2028, 2, 1), 30)).toEqual(utc(2028, 2, 29))
  })
})
