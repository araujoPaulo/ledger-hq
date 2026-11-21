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
  obligationsFrom: null,
}

const employeeProfile: FiscalProfileInput = {
  hasOpenActivity: false,
  vatRegime: 'NOT_APPLICABLE',
  incomeTax: 'PIT_EMPLOYMENT_ONLY',
  hasEmployees: false,
  hasWithholding: false,
  isVatCashBasis: false,
  startedAt: '2021-03-01',
  obligationsFrom: null,
}

const TODAY = '2026-11-21'

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

  it('defaults a missing obligationsFrom to null', () => {
    const { obligationsFrom: _omitted, ...withoutObligationsFrom } = companyProfile
    const result = fiscalProfileInputSchema.safeParse(withoutObligationsFrom)

    expect(result.success && result.data.obligationsFrom).toBeNull()
  })

  it('accepts an explicit obligationsFrom date', () => {
    const result = fiscalProfileInputSchema.safeParse({ ...companyProfile, obligationsFrom: '2026-07-01' })

    expect(result.success && result.data.obligationsFrom).toBe('2026-07-01')
  })

  it('rejects an unknown VAT regime', () => {
    const result = fiscalProfileInputSchema.safeParse({ ...companyProfile, vatRegime: 'YEARLY' })

    expect(result.success).toBe(false)
  })
})

describe('checkFiscalProfileConsistency', () => {
  it('accepts a company profile', () => {
    expect(checkFiscalProfileConsistency('COMPANY', companyProfile, TODAY)).toEqual([])
  })

  it('accepts an employee with no activity of their own', () => {
    expect(checkFiscalProfileConsistency('INDIVIDUAL', employeeProfile, TODAY)).toEqual([])
  })

  it('accepts an employee who also invoices independently', () => {
    expect(checkFiscalProfileConsistency('INDIVIDUAL', sideActivityProfile, TODAY)).toEqual([])
  })

  it('requires open activity on a company', () => {
    const errors = checkFiscalProfileConsistency('COMPANY', {
      ...companyProfile,
      hasOpenActivity: false,
    }, TODAY)

    expect(errors).toContain('fiscal_profile.open_activity_required_for_company')
  })

  it('requires a VAT regime of NOT_APPLICABLE without open activity', () => {
    const errors = checkFiscalProfileConsistency('INDIVIDUAL', {
      ...employeeProfile,
      vatRegime: 'QUARTERLY',
    }, TODAY)

    expect(errors).toContain('fiscal_profile.vat_regime_requires_open_activity')
  })

  it('rejects corporate income tax on an individual', () => {
    const errors = checkFiscalProfileConsistency('INDIVIDUAL', {
      ...employeeProfile,
      incomeTax: 'CIT',
    }, TODAY)

    expect(errors).toContain('fiscal_profile.income_tax_incompatible_with_kind')
  })

  it('rejects personal income tax on a company', () => {
    const errors = checkFiscalProfileConsistency('COMPANY', {
      ...companyProfile,
      incomeTax: 'PIT_CATEGORY_B',
    }, TODAY)

    expect(errors).toContain('fiscal_profile.income_tax_incompatible_with_kind')
  })

  it('rejects the employees flag on an individual', () => {
    const errors = checkFiscalProfileConsistency('INDIVIDUAL', {
      ...employeeProfile,
      hasEmployees: true,
    }, TODAY)

    expect(errors).toContain('fiscal_profile.employees_flag_not_allowed_for_individual')
  })

  it('reports every violation, not just the first', () => {
    const errors = checkFiscalProfileConsistency('INDIVIDUAL', {
      ...employeeProfile,
      incomeTax: 'CIT',
      hasEmployees: true,
    }, TODAY)

    expect(errors).toHaveLength(2)
  })

  it('accepts an obligationsFrom between the start date and today, both ends included', () => {
    for (const obligationsFrom of ['2020-01-01', '2025-06-15', TODAY]) {
      expect(checkFiscalProfileConsistency('COMPANY', { ...companyProfile, obligationsFrom }, TODAY)).toEqual([])
    }
  })

  it('rejects an obligationsFrom before the fiscal profile start date', () => {
    const errors = checkFiscalProfileConsistency('COMPANY', { ...companyProfile, obligationsFrom: '2019-12-31' }, TODAY)

    expect(errors).toEqual(['fiscal_profile.obligations_from_before_start'])
  })

  it('rejects an obligationsFrom after today', () => {
    const errors = checkFiscalProfileConsistency('COMPANY', { ...companyProfile, obligationsFrom: '2026-11-22' }, TODAY)

    expect(errors).toEqual(['fiscal_profile.obligations_from_in_future'])
  })
})
