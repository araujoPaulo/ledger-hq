import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PERIODICITY_VALUES } from '@ledger-hq/domain'
import type { Periodicity } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Dialog, Input, MoneyInput, Select } from '../ui'
import { createRetainerPlan, renewRetainerPlan } from './api'
import type { RetainerPlan } from './api'

type Props = { clientId: string; currentPlan: RetainerPlan | null; onSaved: () => void }

/** Renders inside `Dialog.Content`. Creates a plan, or renews the one in force. */
export function RetainerPlanForm({ clientId, currentPlan, onSaved }: Props) {
  const { t } = useTranslation(['billing', 'domain', 'common'])
  const isRenewal = currentPlan !== null

  const [amountCents, setAmountCents] = useState<number | null>(null)
  const [periodicity, setPeriodicity] = useState<Periodicity>((currentPlan?.periodicity as Periodicity | undefined) ?? 'MONTHLY')
  const [dueDayOfMonth, setDueDayOfMonth] = useState(String(currentPlan?.dueDayOfMonth ?? 8))
  const [effectiveDate, setEffectiveDate] = useState('')

  const mutation = useMutation({
    mutationFn: (cents: number): Promise<RetainerPlan | { closedPlanId: string | null; newPlanId: string }> =>
      isRenewal
        ? renewRetainerPlan(clientId, { newAmountCents: cents, effectiveFrom: effectiveDate })
        : createRetainerPlan(clientId, {
            amountCents: cents,
            periodicity,
            dueDayOfMonth: Number(dueDayOfMonth),
            validFrom: effectiveDate,
          }),
    onSuccess: onSaved,
  })

  // A fee is a positive amount; the form's rule, not MoneyInput's.
  const canSubmit = amountCents !== null && amountCents > 0 && effectiveDate !== ''

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit || amountCents === null) return
        mutation.mutate(amountCents)
      }}
    >
      <MoneyInput
        required
        label={t(isRenewal ? 'billing:retainerPlan.newAmountCents.label' : 'billing:retainerPlan.amountCents.label')}
        onValueChange={setAmountCents}
      />

      {!isRenewal && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={t('billing:retainerPlan.periodicity.label')}
            value={periodicity}
            onChange={(event) => setPeriodicity(event.target.value as Periodicity)}
          >
            {PERIODICITY_VALUES.filter((value) => value !== 'ONE_OFF').map((value) => (
              <option key={value} value={value}>
                {t(`domain:periodicity.${value}`)}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            required
            min={1}
            max={28}
            inputMode="numeric"
            label={t('billing:retainerPlan.dueDayOfMonth.label')}
            value={dueDayOfMonth}
            onChange={(event) => setDueDayOfMonth(event.target.value)}
          />
        </div>
      )}

      <Input
        type="date"
        required
        label={t(isRenewal ? 'billing:retainerPlan.effectiveFrom.label' : 'billing:retainerPlan.validFrom.label')}
        value={effectiveDate}
        onChange={(event) => setEffectiveDate(event.target.value)}
      />

      <ErrorMessage error={mutation.error} />

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="primary" type="submit" isLoading={mutation.isPending} disabled={!canSubmit}>
          {t('common:actions.save')}
        </Button>
      </Dialog.Footer>
    </form>
  )
}
