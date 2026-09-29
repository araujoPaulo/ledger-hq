import { describe, expect, it, vi } from 'vitest'
import type { ArgumentsHost } from '@nestjs/common'
import { MulterError } from 'multer'
import { MulterErrorFilter } from './multer-error.filter.js'

function hostSpy() {
  const json = vi.fn()
  const status = vi.fn().mockReturnValue({ json })
  const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as unknown as ArgumentsHost

  return { host, status, json }
}

describe('MulterErrorFilter', () => {
  // Without this filter the global AppErrorFilter sees a plain
  // HttpException-less Error and renders common.internal_error at 500 — a
  // file one byte over the cap would read as a server bug.
  it('maps LIMIT_FILE_SIZE to attachments.too_large at 413', () => {
    const { host, status, json } = hostSpy()

    new MulterErrorFilter().catch(new MulterError('LIMIT_FILE_SIZE', 'file'), host)

    expect(status).toHaveBeenCalledWith(413)
    expect(json).toHaveBeenCalledWith({ error: { code: 'attachments.too_large', params: { maxBytes: 10 * 1024 * 1024 } } })
  })

  it('maps every other multer failure to common.validation_failed at 422', () => {
    const { host, status, json } = hostSpy()

    new MulterErrorFilter().catch(new MulterError('LIMIT_UNEXPECTED_FILE', 'nope'), host)

    expect(status).toHaveBeenCalledWith(422)
    expect(json).toHaveBeenCalledWith({ error: { code: 'common.validation_failed', params: {} } })
  })
})
