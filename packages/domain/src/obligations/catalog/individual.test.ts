import { describe, expect, it } from 'vitest'
import { resolveDueDate } from '../resolver'
import { INDIVIDUAL_CATALOG } from './individual'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

describe('INDIVIDUAL_CATALOG', () => {
  it('has 1 entry', () => {
    expect(INDIVIDUAL_CATALOG).toHaveLength(1)
  })

  it('MODEL_3_PIT_RETURN: due 30 June of the following year', () => {
    const entry = INDIVIDUAL_CATALOG[0]!
    const period = { start: utc(2025, 1, 1), end: utc(2025, 12, 31), label: '2025' }
    expect(resolveDueDate(entry, period)).toEqual(utc(2026, 6, 30))
  })

  it('applies only to individuals', () => {
    expect(INDIVIDUAL_CATALOG[0]!.appliesWhen).toEqual({ all: [{ field: 'kind', op: 'eq', value: 'INDIVIDUAL' }] })
  })
})
