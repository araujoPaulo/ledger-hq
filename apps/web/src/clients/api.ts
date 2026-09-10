import type { ClientKind, CreateClientInput, FiscalProfileInput, UpdateClientInput } from '@ledger-hq/domain'
import { apiFetch } from '../api/client'

export type ClientResponse = {
  id: string
  kind: ClientKind
  name: string
  taxId: string
  accounting: 'ORGANIZED' | 'SIMPLIFIED'
  email: string | null
  phone: string | null
  notes: string | null
  legalForm: string | null
  socialSecurityNo: string | null
  dateOfBirth: string | null
  archivedAt: string | null
}

export type ClientFilters = { kind?: ClientKind; search?: string; includeArchived?: boolean }

export function listClients(filters: ClientFilters): Promise<ClientResponse[]> {
  const query = new URLSearchParams()
  if (filters.kind) query.set('kind', filters.kind)
  if (filters.search) query.set('search', filters.search)
  if (filters.includeArchived) query.set('includeArchived', 'true')

  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return apiFetch<ClientResponse[]>(`/clients${suffix}`)
}

export const getClient = (id: string) => apiFetch<ClientResponse>(`/clients/${id}`)

export const createClient = (input: CreateClientInput) =>
  apiFetch<ClientResponse>('/clients', { method: 'POST', body: input })

export const updateClient = (id: string, input: UpdateClientInput) =>
  apiFetch<ClientResponse>(`/clients/${id}`, { method: 'PATCH', body: input })

export const archiveClient = (id: string) =>
  apiFetch<ClientResponse>(`/clients/${id}/archive`, { method: 'POST' })

export const restoreClient = (id: string) =>
  apiFetch<ClientResponse>(`/clients/${id}/restore`, { method: 'POST' })

export type FiscalProfileResponse = FiscalProfileInput & { clientId: string; updatedAt: string }

export const getFiscalProfile = (clientId: string) =>
  apiFetch<FiscalProfileResponse>(`/clients/${clientId}/fiscal-profile`)

export const putFiscalProfile = (clientId: string, input: FiscalProfileInput) =>
  apiFetch<FiscalProfileResponse>(`/clients/${clientId}/fiscal-profile`, { method: 'PUT', body: input })
