import { apiFetch } from '../api/client'

export type ReceivablesRow = {
  clientId: string
  clientName: string
  outstandingCents: number
  oldestDueOn: string
  ageingBucket: '0-30' | '31-60' | '61-90' | '90+'
}

export type CurrentMonthRow = { clientId: string; clientName: string; paid: boolean; outstandingCents: number }

export type LedgerEntry = { type: 'CHARGE' | 'PAYMENT'; date: string; description: string; amountCents: number; runningBalanceCents: number }

export type ClientLedger = { entries: LedgerEntry[]; balanceCents: number }

export type GenerateChargesResult = {
  toCreate: Array<{ clientId: string; planId: string; periodLabel: string; amountCents: number; dueOn: string }>
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

export type ProposedAllocation = { chargeId: string; amountCents: number }

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

export function proposeAllocation(clientId: string, amountCents: number): Promise<{ proposed: ProposedAllocation[]; excessCents: number }> {
  return apiFetch('/billing/payments/propose-allocation', { method: 'POST', body: { clientId, amountCents } })
}

export function recordPayment(input: {
  clientId: string
  amountCents: number
  receivedOn: string
  method: string
  reference?: string
  allocations: ProposedAllocation[]
}): Promise<{ paymentId: string }> {
  return apiFetch('/billing/payments', { method: 'POST', body: input })
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

export function createAdHocCharge(input: { clientId: string; description: string; amountCents: number; dueOn: string }): Promise<Charge> {
  return apiFetch('/billing/charges', { method: 'POST', body: input })
}

export function writeOffCharge(id: string, reason: string): Promise<Charge> {
  return apiFetch(`/billing/charges/${id}/write-off`, { method: 'PATCH', body: { reason } })
}
