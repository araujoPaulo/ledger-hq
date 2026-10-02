import { describe, expect, it } from 'vitest'
import { settleOnPaper } from './settle-on-paper'
import type { SettlementCharge } from './settle-on-paper'

function charge(dueOn: string, outstandingCents: number): SettlementCharge {
  return { dueOn: new Date(`${dueOn}T00:00:00Z`), outstandingCents }
}

describe('settleOnPaper', () => {
  it('reports the gross debt untouched when there is no credit', () => {
    const result = settleOnPaper([charge('2026-01-08', 9000)], 0)
    expect(result).toEqual({ grossCents: 9000, outstandingCents: 9000, oldestUncoveredDueOn: new Date('2026-01-08T00:00:00Z') })
  })

  it('nets credit against the gross debt', () => {
    const result = settleOnPaper([charge('2026-01-08', 20000)], 15000)
    expect(result.grossCents).toBe(20000)
    expect(result.outstandingCents).toBe(5000)
    expect(result.oldestUncoveredDueOn).toEqual(new Date('2026-01-08T00:00:00Z'))
  })

  it('drops the oldest-uncovered charge to null once credit covers everything exactly', () => {
    const result = settleOnPaper([charge('2026-01-08', 9000)], 9000)
    expect(result).toEqual({ grossCents: 9000, outstandingCents: 0, oldestUncoveredDueOn: null })
  })

  it('floors net outstanding at zero rather than reporting a negative when credit exceeds the debt', () => {
    const result = settleOnPaper([charge('2026-01-08', 9000)], 30000)
    expect(result.outstandingCents).toBe(0)
    expect(result.oldestUncoveredDueOn).toBeNull()
  })

  it('spends credit oldest charge first, regardless of input order', () => {
    const charges = [charge('2026-03-08', 9000), charge('2026-01-08', 9000), charge('2026-02-08', 9000)]
    // Covers January and February in full, leaving March as the oldest
    // uncovered charge — the walk must sort by dueOn itself, not trust
    // caller order.
    const result = settleOnPaper(charges, 18000)
    expect(result.oldestUncoveredDueOn).toEqual(new Date('2026-03-08T00:00:00Z'))
    expect(result.outstandingCents).toBe(9000)
  })

  it('keeps a partially covered charge as the oldest uncovered one, not the next charge after it', () => {
    const charges = [charge('2026-03-31', 5000), charge('2026-04-30', 8000), charge('2026-05-31', 3000)]
    // 9000 credit fully covers the 5000 charge and reaches 4000 into the
    // 8000 charge — the third charge is never even considered, because the
    // second is already the oldest uncovered one.
    const result = settleOnPaper(charges, 9000)
    expect(result.grossCents).toBe(16000)
    expect(result.outstandingCents).toBe(7000)
    expect(result.oldestUncoveredDueOn).toEqual(new Date('2026-04-30T00:00:00Z'))
  })

  it('reports zero and null for a client with no open charges, whatever credit it holds', () => {
    expect(settleOnPaper([], 5000)).toEqual({ grossCents: 0, outstandingCents: 0, oldestUncoveredDueOn: null })
  })

  it('never mutates the charges array it is given', () => {
    const charges = [charge('2026-03-08', 9000), charge('2026-01-08', 9000)]
    const copy = [...charges]
    settleOnPaper(charges, 5000)
    expect(charges).toEqual(copy)
  })
})
