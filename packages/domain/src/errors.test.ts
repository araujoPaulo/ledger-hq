import { describe, expect, it } from 'vitest'
import { AppError, ERROR_CODES } from './errors'
import { CLIENT_KIND_VALUES } from './enums'

describe('AppError', () => {
  it('carries a machine code, params and an HTTP status', () => {
    const error = new AppError('clients.tax_id_taken', { taxId: '501442600' }, 409)

    expect(error.code).toBe('clients.tax_id_taken')
    expect(error.params).toEqual({ taxId: '501442600' })
    expect(error.status).toBe(409)
  })

  it('defaults to a 400 status and no params', () => {
    const error = new AppError('common.validation_failed')

    expect(error.status).toBe(400)
    expect(error.params).toEqual({})
  })

  it('never exposes prose to the caller', () => {
    const error = new AppError('auth.invalid_credentials')

    expect(error.message).toBe('auth.invalid_credentials')
  })
})

describe('error code registry', () => {
  it('has no duplicates', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })
})

describe('enumerations', () => {
  it('exposes both client kinds', () => {
    expect(CLIENT_KIND_VALUES).toEqual(['COMPANY', 'INDIVIDUAL'])
  })
})
