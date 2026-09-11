import type {
  CreateCredentialInput,
  CreatePlatformInput,
  RotateCredentialInput,
  UpdatePlatformInput,
} from '@ledger-hq/domain'
import { apiFetch } from '../api/client'

export type VaultEnvelopeResponse = { protectedVaultKey: string | null; setUpAt: string | null }

export const getVaultEnvelope = () => apiFetch<VaultEnvelopeResponse>('/auth/vault-envelope')

export type SetUpVaultRequest = { protectedVaultKey: string; recoveryVaultKey: string; recoveryAuthHash: string }

export const postVaultSetup = (input: SetUpVaultRequest) =>
  apiFetch<void>('/auth/vault-setup', { method: 'POST', body: input })

export type RecoverVaultRequest = {
  recoveryAuthHash: string
  kdfSalt: string
  authHash: string
  protectedVaultKey: string
}

export const postVaultRecover = (input: RecoverVaultRequest) =>
  apiFetch<void>('/auth/vault-recover', { method: 'POST', body: input })

export type PlatformResponse = {
  id: string
  name: string
  url: string | null
  authKind: 'PASSWORD' | 'PASSWORD_OTP' | 'CERTIFICATE'
}

export const listPlatforms = () => apiFetch<PlatformResponse[]>('/platforms')

export const createPlatform = (input: CreatePlatformInput) =>
  apiFetch<PlatformResponse>('/platforms', { method: 'POST', body: input })

export const updatePlatform = (id: string, input: UpdatePlatformInput) =>
  apiFetch<PlatformResponse>(`/platforms/${id}`, { method: 'PATCH', body: input })

export type CredentialResponse = {
  id: string
  clientId: string
  platformId: string
  label: string
  updatedAt: string
  ciphertext: string
  iv: string
}

export const createCredential = (input: CreateCredentialInput) =>
  apiFetch<CredentialResponse>('/credentials', { method: 'POST', body: input })

export const listCredentialsForClient = (clientId: string) =>
  apiFetch<CredentialResponse[]>(`/clients/${clientId}/credentials`)

export const rotateCredential = (id: string, input: RotateCredentialInput) =>
  apiFetch<CredentialResponse>(`/credentials/${id}/rotate`, { method: 'POST', body: input })

export type CredentialVersionResponse = { id: string; createdAt: string; ciphertext: string; iv: string }

export const listCredentialVersions = (id: string) =>
  apiFetch<CredentialVersionResponse[]>(`/credentials/${id}/versions`)

export const syncCredentials = (since: string | null) =>
  apiFetch<CredentialResponse[]>(`/vault/sync${since ? `?since=${encodeURIComponent(since)}` : ''}`)
