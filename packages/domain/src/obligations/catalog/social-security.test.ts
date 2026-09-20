import { describe, expect, it } from 'vitest'
import { resolveDueDate } from '../resolver'
import { SOCIAL_SECURITY_CATALOG } from './social-security'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

function findEntry(code: string) {
  const entry = SOCIAL_SECURITY_CATALOG.find((candidate) => candidate.code === code)
  if (!entry) throw new Error(`no catalog entry for ${code}`)
  return entry
}

describe('SOCIAL_SECURITY_CATALOG', () => {
  it('has 2 entries', () => {
    expect(SOCIAL_SECURITY_CATALOG).toHaveLength(2)
  })

  it('SS_REMUNERATION_DECLARATION: 10th of the following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('SS_REMUNERATION_DECLARATION'), period)).toEqual(utc(2026, 2, 10))
  })

  it('SS_CONTRIBUTION_PAYMENT: 20th of the following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('SS_CONTRIBUTION_PAYMENT'), period)).toEqual(utc(2026, 2, 20))
  })
})
