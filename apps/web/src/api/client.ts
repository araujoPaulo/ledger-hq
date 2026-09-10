import type { ErrorCode } from '@ledger-hq/domain'

const BASE_PATH = '/api/v1'

/**
 * Every code the server can return, plus the two the browser client
 * produces itself when it never reaches the server at all.
 */
export type ClientErrorCode = ErrorCode | 'common.offline' | 'common.unexpected'

export class ApiError extends Error {
  readonly code: ClientErrorCode
  readonly params: Record<string, unknown>
  readonly status: number

  constructor(code: ClientErrorCode, params: Record<string, unknown>, status: number) {
    super(code)
    this.name = 'ApiError'
    this.code = code
    this.params = params
    this.status = status
  }
}

type Options = { method?: string; body?: unknown }

export async function apiFetch<T>(path: string, options: Options = {}): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${BASE_PATH}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        // Second lock against cross-site posts; the API rejects mutations
        // that arrive without it.
        'X-Requested-With': 'ledger-hq',
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
  } catch {
    throw new ApiError('common.offline', {}, 0)
  }

  const payload: unknown = await response.json().catch(() => ({}))

  if (!response.ok) {
    const envelope = (payload as { error?: { code?: string; params?: Record<string, unknown> } }).error

    // The payload arrives over the wire as an untyped string; the API
    // contract guarantees it is one of ClientErrorCode's members.
    throw new ApiError(
      (envelope?.code as ClientErrorCode | undefined) ?? 'common.unexpected',
      envelope?.params ?? {},
      response.status,
    )
  }

  return payload as T
}
