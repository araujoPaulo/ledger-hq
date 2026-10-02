import { apiFetch } from '../api/client'

export type AtRiskRow = {
  clientId: string
  clientName: string
  overdueObligations: number
  oldestDueDate: string
  /** What the client owes before its own unspent money is counted. */
  grossOutstandingCents: number
  creditCents: number
  /** Net, floored at zero — what this client actually still owes. */
  outstandingCents: number
  oldestChargeDueOn: string
}

export type PeriodSummary = {
  from: string
  to: string
  obligationsDue: number
  obligationsDone: number
  chargesIssuedCents: number
  paymentsReceivedCents: number
  /**
   * The position at the window's end, not today's. Gross of credit, counts
   * every client including archived ones, and includes charges not yet due
   * — so it will not match the receivables screen's net figure for a
   * client holding unspent credit. `unappliedCreditAtCloseCents` is what
   * bridges that gap.
   */
  outstandingAtCloseCents: number
  /** Unspent payment money at the same instant `outstandingAtCloseCents` reconstructs. */
  unappliedCreditAtCloseCents: number
}

export function getAtRisk(asOf?: string): Promise<AtRiskRow[]> {
  return apiFetch(asOf === undefined ? '/reporting/at-risk' : `/reporting/at-risk?asOf=${asOf}`)
}

export function getPeriodSummary(from: string, to: string): Promise<PeriodSummary> {
  return apiFetch(`/reporting/period-summary?from=${from}&to=${to}`)
}
