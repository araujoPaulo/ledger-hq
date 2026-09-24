import { apiFetch } from '../api/client'

export type ObligationResponse = {
  id: string
  clientId: string
  clientName: string
  definitionCode: string
  definitionName: string
  authority: string
  periodLabel: string
  dueDate: string
  dueDateOverridden: boolean
  status: string
  completedAt: string | null
  reference: string | null
  amountCents: number | null
  notes: string | null
}

export function listObligations(params: { clientId?: string; status?: string } = {}): Promise<ObligationResponse[]> {
  const query = [
    params.clientId ? `clientId=${encodeURIComponent(params.clientId)}` : null,
    params.status ? `status=${encodeURIComponent(params.status)}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join('&')

  return apiFetch<ObligationResponse[]>(`/obligations${query ? `?${query}` : ''}`)
}

export type GenerateObligationsResult = {
  toCreate: Array<{ clientId: string; definitionCode: string; periodLabel: string; dueDate: string }>
  toRetract: Array<{ clientId: string; definitionCode: string; periodLabel: string }>
}

export function generateObligations(
  input: { asOf?: string; clientId?: string },
  dryRun: boolean,
): Promise<GenerateObligationsResult> {
  return apiFetch<GenerateObligationsResult>(`/obligations/generate?dryRun=${dryRun}`, { method: 'POST', body: input })
}

export type PatchObligationInput = {
  dueDate?: string
  status?: string
  reference?: string
  amountCents?: number
  notes?: string
}

export function patchObligation(id: string, input: PatchObligationInput): Promise<ObligationResponse> {
  return apiFetch<ObligationResponse>(`/obligations/${id}`, { method: 'PATCH', body: input })
}

export type CreateAdHocObligationInput = {
  clientId: string
  code: string
  name: string
  periodicity: string
  periodStart: string
  periodEnd: string
  periodLabel: string
  dueDate: string
}

export function createAdHocObligation(input: CreateAdHocObligationInput): Promise<ObligationResponse> {
  return apiFetch<ObligationResponse>('/obligations', { method: 'POST', body: input })
}
