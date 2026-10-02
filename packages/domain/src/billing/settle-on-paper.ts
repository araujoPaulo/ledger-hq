/** Enough of a charge for the walk below: its due date and what remains unpaid. */
export type SettlementCharge = { dueOn: Date; outstandingCents: number }

export type Settlement = {
  /** What is owed before the client's own unspent money is counted. */
  grossCents: number
  /** Net, floored at zero — what is actually still owed. */
  outstandingCents: number
  /**
   * The oldest charge the credit fails to reach in full. `null` once the
   * credit covers every charge (or there were none to begin with) — there
   * is no "oldest uncovered charge" to name.
   */
  oldestUncoveredDueOn: Date | null
}

/**
 * Spends a client's unspent credit against its own open charges **on
 * paper** — no allocation is written here — oldest due date first, the same
 * order a real allocation (`proposeAllocation`) would use, and keeps the
 * first charge the credit fails to cover in full. A charge the credit only
 * partially reaches is still the oldest uncovered one and must not be
 * skipped past.
 *
 * Shared by `getReceivables` (`billing.service.ts`) and the at-risk report
 * (`reports.service.ts`): both screens net a client's unspent credit against
 * its debt and must name the same oldest uncovered charge, or they disagree
 * about who is actually behind. They already drifted apart once before this
 * function existed; extracting the walk here, with its own unit tests,
 * keeps that from happening silently again.
 *
 * Never mutates its input.
 */
export function settleOnPaper(charges: SettlementCharge[], creditCents: number): Settlement {
  const sorted = [...charges].sort((a, b) => a.dueOn.getTime() - b.dueOn.getTime())
  const grossCents = sorted.reduce((sum, charge) => sum + charge.outstandingCents, 0)

  let remainingCredit = creditCents
  let oldestUncoveredDueOn: Date | null = null
  for (const charge of sorted) {
    if (remainingCredit >= charge.outstandingCents) {
      remainingCredit -= charge.outstandingCents
      continue
    }
    oldestUncoveredDueOn = charge.dueOn
    break
  }

  return { grossCents, outstandingCents: Math.max(grossCents - creditCents, 0), oldestUncoveredDueOn }
}
