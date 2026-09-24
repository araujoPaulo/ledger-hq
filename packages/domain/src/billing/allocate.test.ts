import { describe, expect, it } from 'vitest'
import { proposeAllocation } from './allocate'
import type { ChargeBalance } from './types'

// `dueOn` is taken as an ISO string for readability and converted here, so
// every fixture carries the `Date` the database actually returns.
function openCharge(overrides: Omit<Partial<ChargeBalance>, 'dueOn'> & { id: string; dueOn: string; outstandingCents: number }): ChargeBalance {
  return {
    clientId: 'c1',
    kind: 'RETAINER',
    periodLabel: null,
    amountCents: overrides.outstandingCents,
    allocatedCents: 0,
    status: 'OPEN',
    ...overrides,
    dueOn: new Date(`${overrides.dueOn}T00:00:00Z`),
  }
}

describe('proposeAllocation', () => {
  it('allocates a payment that exactly covers one open charge', () => {
    const charges = [openCharge({ id: 'a', dueOn: '2026-01-01', outstandingCents: 9000 })]
    expect(proposeAllocation(9000, charges)).toEqual([{ chargeId: 'a', amountCents: 9000 }])
  })

  it('allocates FIFO across several charges, oldest due date first', () => {
    const charges = [
      openCharge({ id: 'march', dueOn: '2026-03-08', outstandingCents: 9000 }),
      openCharge({ id: 'january', dueOn: '2026-01-08', outstandingCents: 9000 }),
      openCharge({ id: 'february', dueOn: '2026-02-08', outstandingCents: 9000 }),
    ]
    // 360 EUR against four 90 EUR months — the master spec's own example
    // (§8.2) — but this test has only 3 charges totalling 270; the payment
    // fully covers all three in due-date order regardless of input order.
    expect(proposeAllocation(27000, charges)).toEqual([
      { chargeId: 'january', amountCents: 9000 },
      { chargeId: 'february', amountCents: 9000 },
      { chargeId: 'march', amountCents: 9000 },
    ])
  })

  it('partially allocates the last charge the payment reaches, and stops', () => {
    const charges = [
      openCharge({ id: 'january', dueOn: '2026-01-08', outstandingCents: 9000 }),
      openCharge({ id: 'february', dueOn: '2026-02-08', outstandingCents: 9000 }),
    ]
    expect(proposeAllocation(12000, charges)).toEqual([
      { chargeId: 'january', amountCents: 9000 },
      { chargeId: 'february', amountCents: 3000 },
    ])
  })

  it('allocates against a partially-paid charge using only its remaining outstanding balance', () => {
    const charges = [openCharge({ id: 'a', dueOn: '2026-01-08', outstandingCents: 3000, allocatedCents: 6000, amountCents: 9000 })]
    expect(proposeAllocation(9000, charges)).toEqual([{ chargeId: 'a', amountCents: 3000 }])
  })

  it('never allocates more than the payment, leaving the rest unallocated as excess', () => {
    const charges = [openCharge({ id: 'a', dueOn: '2026-01-08', outstandingCents: 5000 })]
    const result = proposeAllocation(30000, charges)
    expect(result).toEqual([{ chargeId: 'a', amountCents: 5000 }])
    const totalAllocated = result.reduce((sum, allocation) => sum + allocation.amountCents, 0)
    expect(totalAllocated).toBeLessThanOrEqual(30000)
  })

  it('ignores a charge with zero outstanding balance', () => {
    const charges = [
      openCharge({ id: 'settled', dueOn: '2026-01-08', outstandingCents: 0, allocatedCents: 9000, amountCents: 9000, status: 'SETTLED' }),
      openCharge({ id: 'open', dueOn: '2026-02-08', outstandingCents: 9000 }),
    ]
    expect(proposeAllocation(9000, charges)).toEqual([{ chargeId: 'open', amountCents: 9000 }])
  })

  it('returns an empty array when there are no open charges', () => {
    expect(proposeAllocation(9000, [])).toEqual([])
  })

  it('returns an empty array when the payment is zero', () => {
    const charges = [openCharge({ id: 'a', dueOn: '2026-01-08', outstandingCents: 9000 })]
    expect(proposeAllocation(0, charges)).toEqual([])
  })

  it('property: never allocates more than each charge\'s own outstanding balance', () => {
    const charges = [
      openCharge({ id: 'a', dueOn: '2026-01-08', outstandingCents: 1500 }),
      openCharge({ id: 'b', dueOn: '2026-02-08', outstandingCents: 4000 }),
    ]
    for (const allocation of proposeAllocation(999999, charges)) {
      const charge = charges.find((c) => c.id === allocation.chargeId)!
      expect(allocation.amountCents).toBeLessThanOrEqual(charge.outstandingCents)
    }
  })
})
