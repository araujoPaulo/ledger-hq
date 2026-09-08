import { describe, expect, it, vi } from 'vitest'
import type { ArgumentsHost } from '@nestjs/common'
import { ForbiddenException } from '@nestjs/common'
import { AppError } from '@ledger-hq/domain'
import { AppErrorFilter } from './app-error.filter.js'

function hostWithResponse() {
  const json = vi.fn()
  const status = vi.fn().mockReturnValue({ json })
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost

  return { host, status, json }
}

describe('AppErrorFilter', () => {
  it('renders the code and params at the error status', () => {
    const { host, status, json } = hostWithResponse()

    new AppErrorFilter().catch(new AppError('clients.tax_id_taken', { taxId: '501442600' }, 409), host)

    expect(status).toHaveBeenCalledWith(409)
    expect(json).toHaveBeenCalledWith({
      error: { code: 'clients.tax_id_taken', params: { taxId: '501442600' } },
    })
  })

  it('never leaks prose', () => {
    const { host, json } = hostWithResponse()

    new AppErrorFilter().catch(new AppError('common.not_found', {}, 404), host)

    const payload = JSON.stringify(json.mock.calls[0]?.[0])
    expect(payload).not.toMatch(/[A-Z][a-z]+ [a-z]+ [a-z]+/)
  })

  it('reduces a framework HttpException to a code-only envelope at its own status', () => {
    const { host, status, json } = hostWithResponse()

    new AppErrorFilter().catch(new ForbiddenException('Forbidden'), host)

    expect(status).toHaveBeenCalledWith(403)
    expect(json).toHaveBeenCalledWith({
      error: { code: 'common.validation_failed', params: {} },
    })
  })

  it('reduces an arbitrary thrown error to a 500 code-only envelope without leaking its message', () => {
    const { host, status, json } = hostWithResponse()

    new AppErrorFilter().catch(new Error('database connection string is postgres://secret'), host)

    expect(status).toHaveBeenCalledWith(500)
    expect(json).toHaveBeenCalledWith({
      error: { code: 'common.validation_failed', params: {} },
    })
    expect(JSON.stringify(json.mock.calls[0]?.[0])).not.toMatch(/secret/)
  })
})
