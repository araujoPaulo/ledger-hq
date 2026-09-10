import { afterEach, describe, expect, it, vi } from 'vitest'
import { toBase64 } from '@ledger-hq/crypto'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ apiFetch, ApiError: class extends Error {} }))

const { createAccount, deriveAuthCredentials } = await import('./credentials')

afterEach(() => {
  apiFetch.mockReset()
})

describe('deriveAuthCredentials', () => {
  it('asks the server for the salt and returns only the auth hash', async () => {
    const kdfSalt = toBase64(new Uint8Array(16).fill(7))
    apiFetch.mockResolvedValue({ kdfSalt, params: {} })

    const result = await deriveAuthCredentials('paulo@example.com', 'a long master password')

    expect(apiFetch).toHaveBeenCalledWith('/auth/kdf?email=paulo%40example.com')
    expect(result.authHash).toHaveLength(44)
    expect(Object.keys(result)).toEqual(['authHash'])
  })

  it('produces a different hash for a different password', async () => {
    const kdfSalt = toBase64(new Uint8Array(16).fill(7))
    apiFetch.mockResolvedValue({ kdfSalt, params: {} })

    const first = await deriveAuthCredentials('paulo@example.com', 'password one')
    const second = await deriveAuthCredentials('paulo@example.com', 'password two')

    expect(first.authHash).not.toBe(second.authHash)
  })
})

describe('createAccount', () => {
  it('generates a fresh salt and never sends the password', async () => {
    apiFetch.mockResolvedValue({})

    await createAccount('paulo@example.com', 'a long master password', 'pt-PT')

    const [path, options] = apiFetch.mock.calls[0] ?? []
    expect(path).toBe('/auth/bootstrap')
    expect(options.method).toBe('POST')
    expect(options.body.kdfSalt).toHaveLength(24)
    expect(options.body.authHash).toHaveLength(44)
    expect(JSON.stringify(options.body)).not.toContain('a long master password')
  })
})
