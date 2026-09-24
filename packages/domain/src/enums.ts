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

export const AUTHORITY_VALUES = ['TAX', 'SOCIAL_SECURITY', 'REGISTRY', 'OTHER'] as const
export type Authority = (typeof AUTHORITY_VALUES)[number]

export const PERIODICITY_VALUES = ['MONTHLY', 'QUARTERLY', 'ANNUAL', 'ONE_OFF'] as const
export type Periodicity = (typeof PERIODICITY_VALUES)[number]

export const OBLIGATION_STATUS_VALUES = ['PENDING', 'IN_PROGRESS', 'DONE', 'WAIVED'] as const
export type ObligationStatus = (typeof OBLIGATION_STATUS_VALUES)[number]

export const DEFINITION_SOURCE_VALUES = ['CATALOG', 'CUSTOM'] as const
export type DefinitionSource = (typeof DEFINITION_SOURCE_VALUES)[number]

export const CHARGE_KIND_VALUES = ['RETAINER', 'EXTRA'] as const
export type ChargeKind = (typeof CHARGE_KIND_VALUES)[number]

export const PAYMENT_METHOD_VALUES = ['TRANSFER', 'CASH', 'DIRECT_DEBIT', 'OTHER'] as const
export type PaymentMethod = (typeof PAYMENT_METHOD_VALUES)[number]

// Derived, never stored (master spec §8.3) — a charge has no status column.
// Exists as an enum purely so the web layer has one shared type for it.
export const CHARGE_STATUS_VALUES = ['OPEN', 'PARTIAL', 'SETTLED', 'WRITTEN_OFF'] as const
export type ChargeStatus = (typeof CHARGE_STATUS_VALUES)[number]
