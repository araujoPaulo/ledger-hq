import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './client'

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiFetch', () => {
  it('sends the CSRF header and credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { id: '1' }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/clients')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/clients',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-Requested-With': 'ledger-hq' }),
      }),
    )
  })

  it('serialises the body as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(201, {}))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/clients', { method: 'POST', body: { name: 'Ana' } })

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ name: 'Ana' }),
    })
  })

  it('throws an ApiError carrying the server error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse(409, { error: { code: 'clients.tax_id_taken', params: { taxId: '501442600' } } }),
      ),
    )

    await expect(apiFetch('/clients')).rejects.toMatchObject({
      code: 'clients.tax_id_taken',
      params: { taxId: '501442600' },
      status: 409,
    })
  })

  it('falls back to a generic code when the server sends no envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(500, {})))

    await expect(apiFetch('/clients')).rejects.toBeInstanceOf(ApiError)
    await expect(apiFetch('/clients')).rejects.toMatchObject({ code: 'common.unexpected' })
  })

  it('surfaces a network failure as an offline code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(apiFetch('/clients')).rejects.toMatchObject({ code: 'common.offline', status: 0 })
  })
})
