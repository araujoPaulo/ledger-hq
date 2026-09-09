import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../api/client'

export type Session = { id: string; email: string; locale: string }

export const SESSION_QUERY_KEY = ['session'] as const

export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => apiFetch<Session>('/auth/session'),
    retry: false,
  })
}

export function useBootstrapRequired() {
  return useQuery({
    queryKey: ['bootstrap-required'],
    queryFn: () => apiFetch<{ required: boolean }>('/auth/bootstrap-required'),
    retry: false,
  })
}
