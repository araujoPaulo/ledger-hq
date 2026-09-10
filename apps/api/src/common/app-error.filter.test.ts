import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArgumentsHost } from '@nestjs/common'
import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common'
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

let loggerErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // Every non-AppError branch now logs; keep the test output clean and let
  // individual tests assert on the spy instead.
  loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  loggerErrorSpy.mockRestore()
})

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

  it('reduces a 403 HttpException (e.g. CsrfGuard) to common.forbidden', () => {
    const { host, status, json } = hostWithResponse()

    new AppErrorFilter().catch(new ForbiddenException('Forbidden'), host)

    expect(status).toHaveBeenCalledWith(403)
    expect(json).toHaveBeenCalledWith({
      error: { code: 'common.forbidden', params: {} },
    })
  })

  it('reduces any other HttpException (e.g. a malformed body) to common.validation_failed at its own status', () => {
    const { host, status, json } = hostWithResponse()

    new AppErrorFilter().catch(new BadRequestException('Unexpected token in JSON'), host)

    expect(status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith({
      error: { code: 'common.validation_failed', params: {} },
    })
  })

  it('reduces an arbitrary thrown error to a 500 common.internal_error envelope without leaking its message', () => {
    const { host, status, json } = hostWithResponse()

    new AppErrorFilter().catch(new Error('database connection string is postgres://secret'), host)

    expect(status).toHaveBeenCalledWith(500)
    expect(json).toHaveBeenCalledWith({
      error: { code: 'common.internal_error', params: {} },
    })
    expect(JSON.stringify(json.mock.calls[0]?.[0])).not.toMatch(/secret/)
  })

  it('logs the exception at error level for every non-AppError branch, while the response stays code-only', () => {
    const { host, json } = hostWithResponse()

    new AppErrorFilter().catch(new Error('database connection string is postgres://secret'), host)

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
    expect(loggerErrorSpy.mock.calls[0]?.[0]).toContain('secret')
    expect(JSON.stringify(json.mock.calls[0]?.[0])).not.toMatch(/secret/)
  })

  it('does not log an AppError, since that branch is not an unexpected fault', () => {
    const { host } = hostWithResponse()

    new AppErrorFilter().catch(new AppError('common.not_found', {}, 404), host)

    expect(loggerErrorSpy).not.toHaveBeenCalled()
  })
})
