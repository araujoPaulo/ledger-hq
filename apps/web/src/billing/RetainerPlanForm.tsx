import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PERIODICITY_VALUES } from '@ledger-hq/domain'
import type { Periodicity } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { createRetainerPlan, renewRetainerPlan } from './api'
import type { RetainerPlan } from './api'

type Props = { clientId: string; currentPlan: RetainerPlan | null; onSaved: () => void }

export function RetainerPlanForm({ clientId, currentPlan, onSaved }: Props) {
  const { t } = useTranslation(['billing', 'domain', 'common'])
  const isRenewal = currentPlan !== null

  const [amountCents, setAmountCents] = useState('')
  const [periodicity, setPeriodicity] = useState<Periodicity>((currentPlan?.periodicity as Periodicity | undefined) ?? 'MONTHLY')
  const [dueDayOfMonth, setDueDayOfMonth] = useState(String(currentPlan?.dueDayOfMonth ?? 8))
  const [effectiveDate, setEffectiveDate] = useState('')

  const mutation = useMutation({
    mutationFn: (): Promise<RetainerPlan | { closedPlanId: string | null; newPlanId: string }> =>
      isRenewal
        ? renewRetainerPlan(clientId, { newAmountCents: Number(amountCents), effectiveFrom: effectiveDate })
        : createRetainerPlan(clientId, { amountCents: Number(amountCents), periodicity, dueDayOfMonth: Number(dueDayOfMonth), validFrom: effectiveDate }),
    onSuccess: () => {
      setAmountCents('')
      setEffectiveDate('')
      onSaved()
    },
  })

  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <h3 className="font-medium">{t(isRenewal ? 'billing:retainerPlan.renewTitle' : 'billing:retainerPlan.createTitle')}</h3>

      <label className="flex flex-col gap-1 text-sm">
        {t(isRenewal ? 'billing:retainerPlan.newAmountCents.label' : 'billing:retainerPlan.amountCents.label')}
        <input
          type="number"
          required
          min={1}
          value={amountCents}
          onChange={(event) => setAmountCents(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      {!isRenewal && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            {t('billing:retainerPlan.periodicity.label')}
            <select
              value={periodicity}
              onChange={(event) => setPeriodicity(event.target.value as Periodicity)}
              className="rounded border border-slate-300 px-2 py-1"
            >
              {PERIODICITY_VALUES.filter((value) => value !== 'ONE_OFF').map((value) => (
                <option key={value} value={value}>
                  {t(`domain:periodicity.${value}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            {t('billing:retainerPlan.dueDayOfMonth.label')}
            <input
              type="number"
              required
              min={1}
              max={28}
              value={dueDayOfMonth}
              onChange={(event) => setDueDayOfMonth(event.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </label>
        </>
      )}

      <label className="flex flex-col gap-1 text-sm">
        {t(isRenewal ? 'billing:retainerPlan.effectiveFrom.label' : 'billing:retainerPlan.validFrom.label')}
        <input
          type="date"
          required
          value={effectiveDate}
          onChange={(event) => setEffectiveDate(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <ErrorMessage error={mutation.error} />

      <button
        type="submit"
        disabled={mutation.isPending}
        className="self-start rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {t('common:actions.save')}
      </button>
    </form>
  )
}
