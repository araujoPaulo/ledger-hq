import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
import { apiUpload } from './upload'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(response: Partial<Response> & { json: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'recibo.pdf', { type: 'application/pdf' })

describe('apiUpload', () => {
  it('sends the CSRF header', async () => {
    const fetchMock = stubFetch({ ok: true, status: 201, json: async () => ({ id: 'a1' }) })

    await apiUpload('/obligations/o1/attachments', file)

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers['X-Requested-With']).toBe('ledger-hq')
  })

  // The browser has to set multipart/form-data itself, because only it knows
  // the boundary. apiFetch hardcodes application/json, which is exactly why
  // this helper exists instead of a flag on that one.
  it('sets no Content-Type of its own', async () => {
    const fetchMock = stubFetch({ ok: true, status: 201, json: async () => ({}) })

    await apiUpload('/obligations/o1/attachments', file)

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain('content-type')
  })

  it('sends the file as multipart under the "file" field', async () => {
    const fetchMock = stubFetch({ ok: true, status: 201, json: async () => ({}) })

    await apiUpload('/obligations/o1/attachments', file)

    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('file')).toBe(file)
  })

  it('throws the server code, not a generic failure', async () => {
    stubFetch({
      ok: false,
      status: 415,
      json: async () => ({ error: { code: 'attachments.type_not_allowed', params: { contentType: 'application/zip' } } }),
    })

    await expect(apiUpload('/obligations/o1/attachments', file)).rejects.toMatchObject({
      code: 'attachments.type_not_allowed',
      status: 415,
    })
  })

  it('reports a dead network as common.offline, like apiFetch does', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(apiUpload('/obligations/o1/attachments', file)).rejects.toBeInstanceOf(ApiError)
    await expect(apiUpload('/obligations/o1/attachments', file)).rejects.toMatchObject({ code: 'common.offline' })
  })
})
