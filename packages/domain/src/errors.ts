/**
 * Every error the API can return. The API never sends prose: the frontend
 * maps these codes to translated messages.
 */
export const ERROR_CODES = [
  'common.validation_failed',
  'common.not_found',
  'common.forbidden',
  'common.internal_error',
  'auth.invalid_credentials',
  'auth.already_bootstrapped',
  'auth.not_bootstrapped',
  'auth.session_expired',
  'clients.tax_id_taken',
  'clients.archived',
  'fiscal_profile.open_activity_required_for_company',
  'fiscal_profile.vat_regime_requires_open_activity',
  'fiscal_profile.income_tax_incompatible_with_kind',
  'fiscal_profile.employees_flag_not_allowed_for_individual',
  'employment.employer_must_be_company',
  'employment.employee_must_be_individual',
  'employment.self_employment',
  'employment.overlapping_spell',
  'employment.ended_before_started',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export class AppError extends Error {
  readonly code: ErrorCode
  readonly params: Record<string, unknown>
  readonly status: number

  constructor(
    code: ErrorCode,
    params: Record<string, unknown> = {},
    status = 400,
  ) {
    super(code)
    this.name = 'AppError'
    this.code = code
    this.params = params
    this.status = status
  }
}
