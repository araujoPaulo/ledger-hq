export const CLIENT_KIND_VALUES = ['COMPANY', 'INDIVIDUAL'] as const
export type ClientKind = (typeof CLIENT_KIND_VALUES)[number]

/**
 * Corporate legal forms only. A Portuguese sole trader is an INDIVIDUAL client
 * with an open activity, not a legal form — see the design spec, section 6.2.
 */
export const LEGAL_FORM_VALUES = [
  'LDA',
  'UNIPESSOAL_LDA',
  'SA',
  'ASSOCIATION',
  'OTHER',
] as const
export type LegalForm = (typeof LEGAL_FORM_VALUES)[number]

export const ACCOUNTING_VALUES = ['ORGANIZED', 'SIMPLIFIED'] as const
export type Accounting = (typeof ACCOUNTING_VALUES)[number]

export const VAT_REGIME_VALUES = [
  'MONTHLY',
  'QUARTERLY',
  'EXEMPT',
  'NOT_APPLICABLE',
] as const
export type VatRegime = (typeof VAT_REGIME_VALUES)[number]

export const INCOME_TAX_VALUES = [
  'CIT',
  'PIT_CATEGORY_B',
  'PIT_EMPLOYMENT_ONLY',
] as const
export type IncomeTax = (typeof INCOME_TAX_VALUES)[number]

export const AUTH_KIND_VALUES = ['PASSWORD', 'PASSWORD_OTP', 'CERTIFICATE'] as const
export type AuthKind = (typeof AUTH_KIND_VALUES)[number]
