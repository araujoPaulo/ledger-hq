import type { AllocationSource, ChargeBalance, ProposedAllocation } from './types'

/**
 * FIFO allocation across a client's open charges, oldest due date first
 * (master spec §8.2), drawing on one or more sources, oldest received first
 * (Phase 4a design §4.2) — so the oldest credit is spent before newer credit.
 * Never mutates its input; never allocates more than a charge's own
 * outstanding balance, and never draws more from a source than that source
 * has available. The caller — never this function — decides whether to apply
 * the proposal as-is or let the accountant redistribute it first.
 */
export function proposeAllocation(sources: AllocationSource[], openCharges: ChargeBalance[]): ProposedAllocation[] {
  const charges = openCharges.filter((charge) => charge.outstandingCents > 0).sort((a, b) => a.dueOn.getTime() - b.dueOn.getTime())
  // Copied, not aliased: the loop below spends each source down, and a
  // caller's array must come back untouched.
  const funds = sources
    .filter((source) => source.availableCents > 0)
    .sort((a, b) => a.receivedOn.getTime() - b.receivedOn.getTime())
    .map((source) => ({ paymentId: source.paymentId, remainingCents: source.availableCents }))

  const allocations: ProposedAllocation[] = []
  let fundIndex = 0

  for (const charge of charges) {
    let remainingOnCharge = charge.outstandingCents

    while (remainingOnCharge > 0 && fundIndex < funds.length) {
      const fund = funds[fundIndex]!
      const amount = Math.min(remainingOnCharge, fund.remainingCents)
      allocations.push({ paymentId: fund.paymentId, chargeId: charge.id, amountCents: amount })
      fund.remainingCents -= amount
      remainingOnCharge -= amount
      if (fund.remainingCents === 0) fundIndex += 1
    }

    if (fundIndex >= funds.length) break
  }

  return allocations
}
