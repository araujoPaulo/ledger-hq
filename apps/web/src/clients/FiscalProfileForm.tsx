import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { INCOME_TAX_VALUES, VAT_REGIME_VALUES, checkFiscalProfileConsistency } from '@ledger-hq/domain'
import type { ClientKind, FiscalProfileInput, IncomeTax, VatRegime } from '@ledger-hq/domain'
import { ErrorMessage, translateErrorCode } from '../shell/ErrorMessage'
import { putFiscalProfile } from './api'
import type { FiscalProfileResponse } from './api'

type Props = {
  clientId: string
  kind: ClientKind
  /** `null` when no profile has been saved yet: GET returns 404 in that case. */
  initial: FiscalProfileResponse | null
}

/**
 * Defaults that already satisfy `checkFiscalProfileConsistency` for the
 * given kind, so a brand-new profile does not open with violations showing.
 */
function defaultsFor(kind: ClientKind): FiscalProfileInput {
  const today = new Date().toISOString().slice(0, 10)

  return kind === 'COMPANY'
    ? {
        hasOpenActivity: true,
        vatRegime: 'MONTHLY',
        incomeTax: 'CIT',
        hasEmployees: false,
        hasWithholding: false,
        isVatCashBasis: false,
        startedAt: today,
      }
    : {
        hasOpenActivity: false,
        vatRegime: 'NOT_APPLICABLE',
        incomeTax: 'PIT_CATEGORY_B',
        hasEmployees: false,
        hasWithholding: false,
        isVatCashBasis: false,
        startedAt: today,
      }
}

function toInput(profile: FiscalProfileResponse): FiscalProfileInput {
  return {
    hasOpenActivity: profile.hasOpenActivity,
    vatRegime: profile.vatRegime,
    incomeTax: profile.incomeTax,
    hasEmployees: profile.hasEmployees,
    hasWithholding: profile.hasWithholding,
    isVatCashBasis: profile.isVatCashBasis,
    startedAt: profile.startedAt,
  }
}

export function FiscalProfileForm({ clientId, kind, initial }: Props) {
  const { t } = useTranslation(['clients', 'domain', 'common'])
  const { t: tError } = useTranslation('errors')
  const queryClient = useQueryClient()

  const [values, setValues] = useState<FiscalProfileInput>(() =>
    initial ? toInput(initial) : defaultsFor(kind),
  )

  // Recomputed on every render, so it reflects the latest edit and never
  // reimplements a rule this function itself already owns.
  const violations = checkFiscalProfileConsistency(kind, values)

  const mutation = useMutation({
    mutationFn: (input: FiscalProfileInput) => putFiscalProfile(clientId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fiscal-profile', clientId] })
    },
  })

  function update<K extends keyof FiscalProfileInput>(key: K, value: FiscalProfileInput[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  return (
    <form
      className="flex flex-col gap-4 rounded border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (violations.length > 0) return
        mutation.mutate(values)
      }}
    >
      <h2 className="text-base font-semibold">{t('clients:profile.title')}</h2>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.hasOpenActivity}
          disabled={kind === 'COMPANY'}
          onChange={(event) => update('hasOpenActivity', event.target.checked)}
        />
        {t('clients:profile.hasOpenActivity')}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('clients:profile.vatRegime')}
        <select
          value={values.vatRegime}
          onChange={(event) => update('vatRegime', event.target.value as VatRegime)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          {VAT_REGIME_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`domain:vatRegime.${value}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('clients:profile.incomeTax')}
        <select
          value={values.incomeTax}
          onChange={(event) => update('incomeTax', event.target.value as IncomeTax)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          {INCOME_TAX_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`domain:incomeTax.${value}`)}
            </option>
          ))}
        </select>
      </label>

      {kind === 'COMPANY' && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values.hasEmployees}
            onChange={(event) => update('hasEmployees', event.target.checked)}
          />
          {t('clients:profile.hasEmployees')}
        </label>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.hasWithholding}
          onChange={(event) => update('hasWithholding', event.target.checked)}
        />
        {t('clients:profile.hasWithholding')}
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.isVatCashBasis}
          onChange={(event) => update('isVatCashBasis', event.target.checked)}
        />
        {t('clients:profile.isVatCashBasis')}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('clients:profile.startedAt')}
        <input
          type="date"
          value={values.startedAt}
          onChange={(event) => update('startedAt', event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      {violations.length > 0 && (
        <ul className="flex flex-col gap-1">
          {violations.map((code) => (
            <li key={code} role="alert" className="text-sm text-red-700">
              {translateErrorCode(tError, code)}
            </li>
          ))}
        </ul>
      )}

      <ErrorMessage error={mutation.error} />

      <button
        type="submit"
        disabled={mutation.isPending || violations.length > 0}
        className="self-start rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {t('common:actions.save')}
      </button>
    </form>
  )
}
