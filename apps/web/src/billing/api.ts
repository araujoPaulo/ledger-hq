import { apiFetch } from '../api/client'

export type AgeingBucket = '0-30' | '31-60' | '61-90' | '90+'

export type ReceivablesRow = {
  clientId: string
  clientName: string
  /** What the client owes before its own unspent money is counted. */
  grossOutstandingCents: number
  /** Unspent payment money, netted off `outstandingCents` notionally. */
  creditCents: number
  /** Net, floored at zero — what this client actually still owes. */
  outstandingCents: number
  oldestDueOn: string
  ageingBucket: AgeingBucket
}

export type CurrentMonthRow = { clientId: string; clientName: string; paid: boolean; outstandingCents: number }

export type LedgerEntry = {
  type: 'CHARGE' | 'PAYMENT' | 'WRITE_OFF'
  date: string
  description: string
  amountCents: number
  runningBalanceCents: number
  chargeId: string | null
  /** True on a written-off charge and on its own write-off entry. */
  writtenOff: boolean
}

export type ClientLedger = { entries: LedgerEntry[]; balanceCents: number; availableCreditCents: number }

export type GenerateChargesResult = {
  toCreate: Array<{ clientId: string; planId: string; periodLabel: string; amountCents: number; dueOn: string }>
  creditToAllocate: ProposedAllocationRow[]
  created: number
  allocated: number
}

export type RetainerPlan = {
  id: string
  clientId: string
  amountCents: number
  periodicity: string
  dueDayOfMonth: number
  validFrom: string
  validTo: string | null
}

/**
 * `paymentId` is `null` on a record-payment proposal (the payment doesn't
 * exist yet) and always set on a credit-application proposal (credit is
 * money already tied to a specific past payment).
 */
export type ProposedAllocation = { paymentId: string | null; chargeId: string; amountCents: number }

/** What the propose endpoint returns: the allocation plus enough of the charge to recognise it. */
export type ProposedAllocationRow = ProposedAllocation & {
  description: string
  periodLabel: string | null
  dueOn: string | null
}

export type ApplyCreditResult = { proposed: ProposedAllocationRow[]; remainingCreditCents: number; allocated: number }

export type Charge = {
  id: string
  clientId: string
  kind: string
  description: string
  periodLabel: string | null
  amountCents: number
  dueOn: string
  writtenOffAt: string | null
  writeOffReason: string | null
}

export function getReceivables(): Promise<ReceivablesRow[]> {
  return apiFetch('/billing/receivables')
}

export function getCurrentMonth(): Promise<CurrentMonthRow[]> {
  return apiFetch('/billing/current-month')
}

export function getClientLedger(clientId: string): Promise<ClientLedger> {
  return apiFetch(`/billing/clients/${clientId}/ledger`)
}

export function generateCharges(input: { asOf?: string; clientId?: string }, dryRun: boolean): Promise<GenerateChargesResult> {
  return apiFetch(`/billing/generate-charges?dryRun=${dryRun}`, { method: 'POST', body: input })
}

export function proposeAllocation(clientId: string, amountCents: number): Promise<{ proposed: ProposedAllocationRow[]; excessCents: number }> {
  return apiFetch('/billing/payments/propose-allocation', { method: 'POST', body: { clientId, amountCents } })
}

export function recordPayment(input: {
  clientId: string
  amountCents: number
  receivedOn: string
  method: string
  reference?: string
  // Only chargeId and amountCents go on the wire here: the payment this
  // creates doesn't have an id yet, unlike an apply-credit allocation.
  allocations: Array<{ chargeId: string; amountCents: number }>
}): Promise<{ paymentId: string }> {
  return apiFetch('/billing/payments', { method: 'POST', body: input })
}

export function applyCredit(clientId: string, dryRun: boolean, allocations?: ProposedAllocation[]): Promise<ApplyCreditResult> {
  return apiFetch(`/billing/clients/${clientId}/apply-credit?dryRun=${dryRun}`, {
    method: 'POST',
    body: { allocations: allocations ?? [] },
  })
}

export function createRetainerPlan(
  clientId: string,
  input: { amountCents: number; periodicity: string; dueDayOfMonth: number; validFrom: string },
): Promise<RetainerPlan> {
  return apiFetch(`/billing/clients/${clientId}/retainer-plan`, { method: 'POST', body: input })
}

export function renewRetainerPlan(
  clientId: string,
  input: { newAmountCents: number; effectiveFrom: string; periodicity?: string; dueDayOfMonth?: number },
): Promise<{ closedPlanId: string | null; newPlanId: string }> {
  return apiFetch(`/billing/clients/${clientId}/retainer-plan/renew`, { method: 'POST', body: input })
}

export function getCurrentRetainerPlan(clientId: string): Promise<RetainerPlan | null> {
  return apiFetch(`/billing/clients/${clientId}/retainer-plan`)
}

export function createAdHocCharge(input: { clientId: string; description: string; amountCents: number; dueOn: string }): Promise<Charge> {
  return apiFetch('/billing/charges', { method: 'POST', body: input })
}

export function writeOffCharge(id: string, reason: string): Promise<Charge> {
  return apiFetch(`/billing/charges/${id}/write-off`, { method: 'PATCH', body: { reason } })
}
