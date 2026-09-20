import type { ChargeBalance, ProposedAllocation } from './types'

/**
 * FIFO allocation of a payment across a client's open charges, oldest due
 * date first, until the payment is exhausted (master spec §8.2). Never
 * mutates its input; never allocates more than a charge's own outstanding
 * balance or more than the payment amount in total. The caller — never this
 * function — decides whether to apply the proposal as-is or let the
 * accountant redistribute it first.
 */
export function proposeAllocation(paymentAmountCents: number, openCharges: ChargeBalance[]): ProposedAllocation[] {
  const sorted = [...openCharges].filter((charge) => charge.outstandingCents > 0).sort((a, b) => a.dueOn.localeCompare(b.dueOn))

  const allocations: ProposedAllocation[] = []
  let remaining = paymentAmountCents

  for (const charge of sorted) {
    if (remaining <= 0) break
    const amount = Math.min(remaining, charge.outstandingCents)
    allocations.push({ chargeId: charge.id, amountCents: amount })
    remaining -= amount
  }

  return allocations
}
