import { describe, expect, it } from 'vitest'
import { resolveDueDate } from '../resolver'
import { TAX_CATALOG } from './tax'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

function findEntry(code: string) {
  const entry = TAX_CATALOG.find((candidate) => candidate.code === code)
  if (!entry) throw new Error(`no catalog entry for ${code}`)
  return entry
}

describe('TAX_CATALOG', () => {
  it('has 15 entries, one per code, no duplicates', () => {
    const codes = TAX_CATALOG.map((entry) => entry.code)
    expect(codes).toHaveLength(15)
    expect(new Set(codes).size).toBe(15)
  })

  it('VAT_MONTHLY_RETURN: 20th of the 2nd following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('VAT_MONTHLY_RETURN'), period)).toEqual(utc(2026, 3, 20))
  })

  it('VAT_QUARTERLY_RETURN: 20th of the 2nd following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 3, 31), label: '2026-Q1' }
    expect(resolveDueDate(findEntry('VAT_QUARTERLY_RETURN'), period)).toEqual(utc(2026, 5, 20))
  })

  it('VAT_PAYMENT_MONTHLY: 25th of the 2nd following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('VAT_PAYMENT_MONTHLY'), period)).toEqual(utc(2026, 3, 25))
  })

  it('VAT_PAYMENT_QUARTERLY: 25th of the 2nd following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 3, 31), label: '2026-Q1' }
    expect(resolveDueDate(findEntry('VAT_PAYMENT_QUARTERLY'), period)).toEqual(utc(2026, 5, 25))
  })

  it('EFATURA_INVOICE_REPORTING: 5th of the following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('EFATURA_INVOICE_REPORTING'), period)).toEqual(utc(2026, 2, 5))
  })

  it('DMR_AT: 10th of the following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('DMR_AT'), period)).toEqual(utc(2026, 2, 10))
  })

  it('WITHHOLDING_TAX_PAYMENT: 20th of the following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('WITHHOLDING_TAX_PAYMENT'), period)).toEqual(utc(2026, 2, 20))
  })

  it('MODEL_22_CIT_RETURN: 31 May, shifted forward when it lands on a Sunday', () => {
    const period = { start: utc(2025, 1, 1), end: utc(2025, 12, 31), label: '2025' }
    // 31 May 2026 is a Sunday; next business day is Monday 1 June 2026.
    expect(resolveDueDate(findEntry('MODEL_22_CIT_RETURN'), period)).toEqual(utc(2026, 6, 1))
  })

  it('IES_ANNUAL_FILING: 15 July', () => {
    const period = { start: utc(2025, 1, 1), end: utc(2025, 12, 31), label: '2025' }
    expect(resolveDueDate(findEntry('IES_ANNUAL_FILING'), period)).toEqual(utc(2026, 7, 15))
  })

  it('CIT_PAYMENT_ON_ACCOUNT_1: last day of July, same year', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 12, 31), label: '2026' }
    expect(resolveDueDate(findEntry('CIT_PAYMENT_ON_ACCOUNT_1'), period)).toEqual(utc(2026, 7, 31))
  })

  it('CIT_PAYMENT_ON_ACCOUNT_2: last day of September, same year', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 12, 31), label: '2026' }
    expect(resolveDueDate(findEntry('CIT_PAYMENT_ON_ACCOUNT_2'), period)).toEqual(utc(2026, 9, 30))
  })

  it('CIT_PAYMENT_ON_ACCOUNT_3: 15 December, same year', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 12, 31), label: '2026' }
    expect(resolveDueDate(findEntry('CIT_PAYMENT_ON_ACCOUNT_3'), period)).toEqual(utc(2026, 12, 15))
  })

  it('MODEL_10_INCOME_WITHHOLDING: 31 January, shifted forward when it lands on a Saturday', () => {
    const period = { start: utc(2025, 1, 1), end: utc(2025, 12, 31), label: '2025' }
    // 31 January 2026 is a Saturday; next business day is Monday 2 February 2026.
    expect(resolveDueDate(findEntry('MODEL_10_INCOME_WITHHOLDING'), period)).toEqual(utc(2026, 2, 2))
  })

  it('MODEL_30_NON_RESIDENT_PAYMENTS: end of the 2nd following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('MODEL_30_NON_RESIDENT_PAYMENTS'), period)).toEqual(utc(2026, 3, 31))
  })

  it('INVENTORY_REPORTING: 31 January, shifted forward when it lands on a Saturday', () => {
    const period = { start: utc(2025, 1, 1), end: utc(2025, 12, 31), label: '2025' }
    expect(resolveDueDate(findEntry('INVENTORY_REPORTING'), period)).toEqual(utc(2026, 2, 2))
  })
})
