import { ApiError } from './client'
import type { ClientErrorCode } from './client'

const BASE_PATH = '/api/v1'

/**
 * A multipart POST, beside `apiFetch` rather than inside it.
 *
 * `apiFetch` always sets `Content-Type: application/json`. A multipart body
 * must not carry that header at all: only the browser knows the boundary it
 * generated, and overriding it produces a body the server cannot parse. The
 * CSRF header still has to go out, because `CsrfGuard` rejects every
 * mutation without it.
 */
export async function apiUpload<T>(path: string, file: File, field = 'file'): Promise<T> {
  const body = new FormData()
  body.append(field, file)

  let response: Response

  try {
    response = await fetch(`${BASE_PATH}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'ledger-hq' },
      body,
    })
  } catch {
    throw new ApiError('common.offline', {}, 0)
  }

  const payload: unknown = await response.json().catch(() => ({}))

  if (!response.ok) {
    const envelope = (payload as { error?: { code?: string; params?: Record<string, unknown> } }).error

    throw new ApiError(
      (envelope?.code as ClientErrorCode | undefined) ?? 'common.unexpected',
      envelope?.params ?? {},
      response.status,
    )
  }

  return payload as T
}
