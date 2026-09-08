import { describe, expect, it } from 'vitest'
import { checkFiscalProfileConsistency, fiscalProfileInputSchema } from './fiscal-profile'
import type { FiscalProfileInput } from './fiscal-profile'

const companyProfile: FiscalProfileInput = {
  hasOpenActivity: true,
  vatRegime: 'QUARTERLY',
  incomeTax: 'CIT',
  hasEmployees: true,
  hasWithholding: true,
  isVatCashBasis: false,
  startedAt: '2020-01-01',
}

const employeeProfile: FiscalProfileInput = {
  hasOpenActivity: false,
  vatRegime: 'NOT_APPLICABLE',
  incomeTax: 'PIT_EMPLOYMENT_ONLY',
  hasEmployees: false,
  hasWithholding: false,
  isVatCashBasis: false,
  startedAt: '2021-03-01',
}

const sideActivityProfile: FiscalProfileInput = {
  ...employeeProfile,
  hasOpenActivity: true,
  vatRegime: 'QUARTERLY',
  incomeTax: 'PIT_CATEGORY_B',
}

describe('fiscalProfileInputSchema', () => {
  it('accepts a well-formed profile', () => {
    expect(fiscalProfileInputSchema.safeParse(companyProfile).success).toBe(true)
  })

  it('rejects an unknown VAT regime', () => {
    const result = fiscalProfileInputSchema.safeParse({ ...companyProfile, vatRegime: 'YEARLY' })

    expect(result.success).toBe(false)
  })
})

describe('checkFiscalProfileConsistency', () => {
  it('accepts a company profile', () => {
    expect(checkFiscalProfileConsistency('COMPANY', companyProfile)).toEqual([])
  })

  it('accepts an employee with no activity of their own', () => {
    expect(checkFiscalProfileConsistency('INDIVIDUAL', employeeProfile)).toEqual([])
  })

  it('accepts an employee who also invoices independently', () => {
    expect(checkFiscalProfileConsistency('INDIVIDUAL', sideActivityProfile)).toEqual([])
  })

  it('requires open activity on a company', () => {
    const errors = checkFiscalProfileConsistency('COMPANY', {
      ...companyProfile,
      hasOpenActivity: false,
    })

    expect(errors).toContain('fiscal_profile.open_activity_required_for_company')
  })

  it('requires a VAT regime of NOT_APPLICABLE without open activity', () => {
    const errors = checkFiscalProfileConsistency('INDIVIDUAL', {
      ...employeeProfile,
      vatRegime: 'QUARTERLY',
    })

    expect(errors).toContain('fiscal_profile.vat_regime_requires_open_activity')
  })

  it('rejects corporate income tax on an individual', () => {
    const errors = checkFiscalProfileConsistency('INDIVIDUAL', {
      ...employeeProfile,
      incomeTax: 'CIT',
    })

    expect(errors).toContain('fiscal_profile.income_tax_incompatible_with_kind')
  })

  it('rejects personal income tax on a company', () => {
    const errors = checkFiscalProfileConsistency('COMPANY', {
      ...companyProfile,
      incomeTax: 'PIT_CATEGORY_B',
    })

    expect(errors).toContain('fiscal_profile.income_tax_incompatible_with_kind')
  })

  it('rejects the employees flag on an individual', () => {
    const errors = checkFiscalProfileConsistency('INDIVIDUAL', {
      ...employeeProfile,
      hasEmployees: true,
    })

    expect(errors).toContain('fiscal_profile.employees_flag_not_allowed_for_individual')
  })

  it('reports every violation, not just the first', () => {
    const errors = checkFiscalProfileConsistency('INDIVIDUAL', {
      ...employeeProfile,
      incomeTax: 'CIT',
      hasEmployees: true,
    })

    expect(errors).toHaveLength(2)
  })
})
