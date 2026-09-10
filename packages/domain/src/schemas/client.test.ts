import { describe, expect, it } from 'vitest'
import { createClientSchema } from './client'

const company = {
  kind: 'COMPANY',
  name: 'Padaria Central, Lda.',
  taxId: '501442600',
  accounting: 'ORGANIZED',
  legalForm: 'LDA',
} as const

const individual = {
  kind: 'INDIVIDUAL',
  name: 'Maria Santos',
  taxId: '123456789',
  accounting: 'SIMPLIFIED',
} as const

describe('createClientSchema', () => {
  it('accepts a company with a legal form', () => {
    expect(createClientSchema.safeParse(company).success).toBe(true)
  })

  it('accepts an individual with optional personal fields', () => {
    const result = createClientSchema.safeParse({
      ...individual,
      socialSecurityNo: '11234567890',
      dateOfBirth: '1980-07-14',
    })

    expect(result.success).toBe(true)
  })

  it('rejects a company without a legal form', () => {
    const { legalForm: _omitted, ...withoutLegalForm } = company

    expect(createClientSchema.safeParse(withoutLegalForm).success).toBe(false)
  })

  it('rejects a legal form on an individual', () => {
    const result = createClientSchema.safeParse({ ...individual, legalForm: 'LDA' })

    expect(result.success).toBe(false)
  })

  it('rejects personal fields on a company', () => {
    const result = createClientSchema.safeParse({
      ...company,
      socialSecurityNo: '11234567890',
    })

    expect(result.success).toBe(false)
  })

  it('rejects an invalid tax number', () => {
    expect(createClientSchema.safeParse({ ...company, taxId: '501442601' }).success).toBe(false)
  })

  it('trims the name and rejects an empty one', () => {
    const parsed = createClientSchema.parse({ ...company, name: '  Padaria  ' })
    expect(parsed.name).toBe('Padaria')

    expect(createClientSchema.safeParse({ ...company, name: '   ' }).success).toBe(false)
  })

  it('rejects a malformed date of birth', () => {
    const result = createClientSchema.safeParse({ ...individual, dateOfBirth: '14/07/1980' })

    expect(result.success).toBe(false)
  })
})
