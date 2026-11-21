import { z } from 'zod'
import { INCOME_TAX_VALUES, VAT_REGIME_VALUES } from '../enums'
import type { ClientKind } from '../enums'
import type { ErrorCode } from '../errors'
import { isoDateSchema } from './common'

export const fiscalProfileInputSchema = z
  .object({
    hasOpenActivity: z.boolean(),
    vatRegime: z.enum(VAT_REGIME_VALUES),
    incomeTax: z.enum(INCOME_TAX_VALUES),
    hasEmployees: z.boolean(),
    hasWithholding: z.boolean(),
    isVatCashBasis: z.boolean(),
    startedAt: isoDateSchema,
    /**
     * Where the obligation generator starts, when later than `startedAt`
     * (e.g. a client taken over mid-activity whose earlier obligations were
     * handled elsewhere). `null` means "from `startedAt`".
     */
    obligationsFrom: isoDateSchema.nullable().default(null),
  })
  .strict()

export type FiscalProfileInput = z.infer<typeof fiscalProfileInputSchema>

/**
 * Rules that depend on the client's kind or on today's date, neither of
 * which the payload carries. `today` is an ISO date (`YYYY-MM-DD`), passed
 * in rather than read so this stays a pure function. Returns every violation
 * so a form can highlight all of them at once.
 */
export function checkFiscalProfileConsistency(
  kind: ClientKind,
  input: FiscalProfileInput,
  today: string,
): ErrorCode[] {
  const errors: ErrorCode[] = []

  if (kind === 'COMPANY' && !input.hasOpenActivity) {
    errors.push('fiscal_profile.open_activity_required_for_company')
  }

  if (!input.hasOpenActivity && input.vatRegime !== 'NOT_APPLICABLE') {
    errors.push('fiscal_profile.vat_regime_requires_open_activity')
  }

  const corporateTax = input.incomeTax === 'CIT'
  if (corporateTax !== (kind === 'COMPANY')) {
    errors.push('fiscal_profile.income_tax_incompatible_with_kind')
  }

  if (kind === 'INDIVIDUAL' && input.hasEmployees) {
    errors.push('fiscal_profile.employees_flag_not_allowed_for_individual')
  }

  // ISO dates compare correctly as strings.
  if (input.obligationsFrom !== null) {
    if (input.obligationsFrom < input.startedAt) {
      errors.push('fiscal_profile.obligations_from_before_start')
    } else if (input.obligationsFrom > today) {
      errors.push('fiscal_profile.obligations_from_in_future')
    }
  }

  return errors
}
