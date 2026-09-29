import { describe, expect, it } from 'vitest'
import { proposeAllocation } from './allocate'
import type { AllocationSource, ChargeBalance } from './types'

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

function source(overrides: { paymentId?: string | null; availableCents: number; receivedOn: string }): AllocationSource {
  return {
    paymentId: overrides.paymentId ?? null,
    availableCents: overrides.availableCents,
    receivedOn: new Date(`${overrides.receivedOn}T00:00:00Z`),
  }
}

describe('proposeAllocation', () => {
  it('allocates a payment that exactly covers one open charge', () => {
    const charges = [openCharge({ id: 'a', dueOn: '2026-01-01', outstandingCents: 9000 })]
    expect(proposeAllocation([source({ availableCents: 9000, receivedOn: '2026-01-01' })], charges)).toEqual([{ paymentId: null, chargeId: 'a', amountCents: 9000 }])
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
    expect(proposeAllocation([source({ availableCents: 27000, receivedOn: '2026-01-01' })], charges)).toEqual([
      { paymentId: null, chargeId: 'january', amountCents: 9000 },
      { paymentId: null, chargeId: 'february', amountCents: 9000 },
      { paymentId: null, chargeId: 'march', amountCents: 9000 },
    ])
  })

  it('partially allocates the last charge the payment reaches, and stops', () => {
    const charges = [
      openCharge({ id: 'january', dueOn: '2026-01-08', outstandingCents: 9000 }),
      openCharge({ id: 'february', dueOn: '2026-02-08', outstandingCents: 9000 }),
    ]
    expect(proposeAllocation([source({ availableCents: 12000, receivedOn: '2026-01-01' })], charges)).toEqual([
      { paymentId: null, chargeId: 'january', amountCents: 9000 },
      { paymentId: null, chargeId: 'february', amountCents: 3000 },
    ])
  })

  it('allocates against a partially-paid charge using only its remaining outstanding balance', () => {
    const charges = [openCharge({ id: 'a', dueOn: '2026-01-08', outstandingCents: 3000, allocatedCents: 6000, amountCents: 9000 })]
    expect(proposeAllocation([source({ availableCents: 9000, receivedOn: '2026-01-01' })], charges)).toEqual([{ paymentId: null, chargeId: 'a', amountCents: 3000 }])
  })

  it('never allocates more than the payment, leaving the rest unallocated as excess', () => {
    const charges = [openCharge({ id: 'a', dueOn: '2026-01-08', outstandingCents: 5000 })]
    const result = proposeAllocation([source({ availableCents: 30000, receivedOn: '2026-01-01' })], charges)
    expect(result).toEqual([{ paymentId: null, chargeId: 'a', amountCents: 5000 }])
    const totalAllocated = result.reduce((sum, allocation) => sum + allocation.amountCents, 0)
    expect(totalAllocated).toBeLessThanOrEqual(30000)
  })

  it('ignores a charge with zero outstanding balance', () => {
    const charges = [
      openCharge({ id: 'settled', dueOn: '2026-01-08', outstandingCents: 0, allocatedCents: 9000, amountCents: 9000, status: 'SETTLED' }),
      openCharge({ id: 'open', dueOn: '2026-02-08', outstandingCents: 9000 }),
    ]
    expect(proposeAllocation([source({ availableCents: 9000, receivedOn: '2026-01-01' })], charges)).toEqual([{ paymentId: null, chargeId: 'open', amountCents: 9000 }])
  })

  it('returns an empty array when there are no open charges', () => {
    expect(proposeAllocation([source({ availableCents: 9000, receivedOn: '2026-01-01' })], [])).toEqual([])
  })

  it('returns an empty array when there are no sources', () => {
    const charges = [openCharge({ id: 'a', dueOn: '2026-01-08', outstandingCents: 9000 })]
    expect(proposeAllocation([], charges)).toEqual([])
  })

  it('property: never allocates more than each charge\'s own outstanding balance', () => {
    const charges = [
      openCharge({ id: 'a', dueOn: '2026-01-08', outstandingCents: 1500 }),
      openCharge({ id: 'b', dueOn: '2026-02-08', outstandingCents: 4000 }),
    ]
    for (const allocation of proposeAllocation([source({ availableCents: 999999, receivedOn: '2026-01-01' })], charges)) {
      const charge = charges.find((c) => c.id === allocation.chargeId)!
      expect(allocation.amountCents).toBeLessThanOrEqual(charge.outstandingCents)
    }
  })
})

describe('proposeAllocation with several sources', () => {
  it('spends the oldest source first', () => {
    const charges = [openCharge({ id: 'jan', dueOn: '2026-01-08', outstandingCents: 9000 })]
    const sources = [
      source({ paymentId: 'newer', availableCents: 9000, receivedOn: '2026-03-01' }),
      source({ paymentId: 'older', availableCents: 9000, receivedOn: '2026-02-01' }),
    ]
    expect(proposeAllocation(sources, charges)).toEqual([{ paymentId: 'older', chargeId: 'jan', amountCents: 9000 }])
  })

  it('splits one charge across two sources when neither covers it alone', () => {
    const charges = [openCharge({ id: 'jan', dueOn: '2026-01-08', outstandingCents: 9000 })]
    const sources = [
      source({ paymentId: 'a', availableCents: 4000, receivedOn: '2026-02-01' }),
      source({ paymentId: 'b', availableCents: 8000, receivedOn: '2026-03-01' }),
    ]
    expect(proposeAllocation(sources, charges)).toEqual([
      { paymentId: 'a', chargeId: 'jan', amountCents: 4000 },
      { paymentId: 'b', chargeId: 'jan', amountCents: 5000 },
    ])
  })

  it('spends one source across several charges, oldest charge first', () => {
    const charges = [
      openCharge({ id: 'feb', dueOn: '2026-02-08', outstandingCents: 9000 }),
      openCharge({ id: 'jan', dueOn: '2026-01-08', outstandingCents: 9000 }),
    ]
    const sources = [source({ paymentId: 'a', availableCents: 15000, receivedOn: '2026-01-01' })]
    expect(proposeAllocation(sources, charges)).toEqual([
      { paymentId: 'a', chargeId: 'jan', amountCents: 9000 },
      { paymentId: 'a', chargeId: 'feb', amountCents: 6000 },
    ])
  })

  it('skips a source with nothing left on it', () => {
    const charges = [openCharge({ id: 'jan', dueOn: '2026-01-08', outstandingCents: 9000 })]
    const sources = [
      source({ paymentId: 'spent', availableCents: 0, receivedOn: '2026-01-01' }),
      source({ paymentId: 'live', availableCents: 9000, receivedOn: '2026-02-01' }),
    ]
    expect(proposeAllocation(sources, charges)).toEqual([{ paymentId: 'live', chargeId: 'jan', amountCents: 9000 }])
  })

  it('proposes nothing when there are no sources', () => {
    const charges = [openCharge({ id: 'jan', dueOn: '2026-01-08', outstandingCents: 9000 })]
    expect(proposeAllocation([], charges)).toEqual([])
  })

  it('never draws more from a source than it has available', () => {
    const charges = [
      openCharge({ id: 'jan', dueOn: '2026-01-08', outstandingCents: 50000 }),
      openCharge({ id: 'feb', dueOn: '2026-02-08', outstandingCents: 50000 }),
    ]
    const sources = [
      source({ paymentId: 'a', availableCents: 12345, receivedOn: '2026-01-01' }),
      source({ paymentId: 'b', availableCents: 6789, receivedOn: '2026-01-02' }),
    ]
    const drawn = new Map<string | null, number>()
    for (const allocation of proposeAllocation(sources, charges)) {
      drawn.set(allocation.paymentId, (drawn.get(allocation.paymentId) ?? 0) + allocation.amountCents)
    }
    expect(drawn.get('a')).toBe(12345)
    expect(drawn.get('b')).toBe(6789)
  })
})
