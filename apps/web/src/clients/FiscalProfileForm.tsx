import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CircleAlert } from 'lucide-react'
import { INCOME_TAX_VALUES, VAT_REGIME_VALUES, checkFiscalProfileConsistency } from '@ledger-hq/domain'
import type { ClientKind, FiscalProfileInput, IncomeTax, VatRegime } from '@ledger-hq/domain'
import { ErrorMessage, translateErrorCode } from '../shell/ErrorMessage'
import { Button, Callout, Checkbox, Dialog, Input, Select } from '../ui'
import { putFiscalProfile } from './api'
import type { FiscalProfileResponse } from './api'

type Props = {
  clientId: string
  kind: ClientKind
  /** `null` when no profile has been saved yet: GET returns 404 in that case. */
  initial: FiscalProfileResponse | null
  /** Called once the save and its invalidations are done; the card closes its dialog. */
  onSaved: () => void
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

/** Renders inside `Dialog.Content`: its footer is a `Dialog.Footer` with a `Dialog.Close`. */
export function FiscalProfileForm({ clientId, kind, initial, onSaved }: Props) {
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
      await queryClient.invalidateQueries({ queryKey: ['obligations-preview', clientId] })
      onSaved()
    },
  })

  function update<K extends keyof FiscalProfileInput>(key: K, value: FiscalProfileInput[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (violations.length > 0) return
        mutation.mutate(values)
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label={t('clients:profile.vatRegime')}
          value={values.vatRegime}
          onChange={(event) => update('vatRegime', event.target.value as VatRegime)}
        >
          {VAT_REGIME_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`domain:vatRegime.${value}`)}
            </option>
          ))}
        </Select>
        <Select
          label={t('clients:profile.incomeTax')}
          value={values.incomeTax}
          onChange={(event) => update('incomeTax', event.target.value as IncomeTax)}
        >
          {INCOME_TAX_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`domain:incomeTax.${value}`)}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          label={t('clients:profile.startedAt')}
          value={values.startedAt}
          onChange={(event) => update('startedAt', event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-4">
        {/* Disabled is right here: for a company the flag applies and cannot change. */}
        <Checkbox
          label={t('clients:profile.hasOpenActivity')}
          checked={values.hasOpenActivity}
          disabled={kind === 'COMPANY'}
          description={kind === 'COMPANY' ? t('clients:profile.openActivityCompany') : undefined}
          onChange={(event) => update('hasOpenActivity', event.target.checked)}
        />
        {kind === 'COMPANY' && (
          <Checkbox
            label={t('clients:profile.hasEmployees')}
            checked={values.hasEmployees}
            onChange={(event) => update('hasEmployees', event.target.checked)}
          />
        )}
        <Checkbox
          label={t('clients:profile.hasWithholding')}
          checked={values.hasWithholding}
          onChange={(event) => update('hasWithholding', event.target.checked)}
        />
        <Checkbox
          label={t('clients:profile.isVatCashBasis')}
          checked={values.isVatCashBasis}
          onChange={(event) => update('isVatCashBasis', event.target.checked)}
        />
      </div>

      {violations.length > 0 && (
        <Callout tone="danger" icon={CircleAlert} role="alert">
          <ul className="flex flex-col gap-1">
            {violations.map((code) => (
              <li key={code}>{translateErrorCode(tError, code)}</li>
            ))}
          </ul>
        </Callout>
      )}

      <ErrorMessage error={mutation.error} />

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="primary" type="submit" isLoading={mutation.isPending} disabled={violations.length > 0}>
          {t('common:actions.save')}
        </Button>
      </Dialog.Footer>
    </form>
  )
}
