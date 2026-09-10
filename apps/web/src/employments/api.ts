import type { CreateEmploymentInput } from '@ledger-hq/domain'
import { apiFetch } from '../api/client'

export type EmploymentResponse = {
  id: string
  employerId: string
  employerName: string
  employeeId: string
  employeeName: string
  startedOn: string
  endedOn: string | null
  jobTitle: string | null
  notes: string | null
}

export const listEmployments = (clientId: string) =>
  apiFetch<EmploymentResponse[]>(`/clients/${clientId}/employments`)

export const createEmployment = (input: CreateEmploymentInput) =>
  apiFetch<EmploymentResponse>('/employments', { method: 'POST', body: input })

export const endEmployment = (id: string, endedOn: string) =>
  apiFetch<EmploymentResponse>(`/employments/${id}/end`, { method: 'POST', body: { endedOn } })
