import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PAYMENT_METHOD_VALUES } from '@ledger-hq/domain'
import type { PaymentMethod } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatCurrency, formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Button, DataList, Dialog, Input, Money, MoneyInput, Select } from '../ui'
import { proposeAllocation, recordPayment } from './api'
import type { ProposedAllocationRow } from './api'

type Props = { clientId: string; onRecorded: () => void }

/**
 * Renders inside `Dialog.Content`. Two steps in one dialog: propose an
 * allocation, then confirm it — the footer's primary action changes with
 * the step.
 */
export function RecordPaymentForm({ clientId, onRecorded }: Props) {
  const { t, i18n } = useTranslation(['billing', 'domain', 'common'])
  const locale = i18n.language as SupportedLocale
  const [amountCents, setAmountCents] = useState<number | null>(null)
  const [receivedOn, setReceivedOn] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('TRANSFER')
  const [proposal, setProposal] = useState<{ proposed: ProposedAllocationRow[]; excessCents: number } | null>(null)

  // A proposal is only valid for the amount it was built from. Editing the
  // amount (or the date) after proposing must retract it, or Confirmar would
  // post the new amount against the old allocations — recording, say, a
  // 150,00 € payment with 15,00 € allocated, silently.
  const resetProposal = () => setProposal(null)

  const propose = useMutation({
    mutationFn: (cents: number) => proposeAllocation(clientId, cents),
    onSuccess: (result) => setProposal(result),
  })

  const confirm = useMutation({
    mutationFn: (cents: number) =>
      recordPayment({
        clientId,
        amountCents: cents,
        receivedOn,
        method,
        // Only the allocation half goes back on the wire; the description
        // and period the proposal carries are for the operator, and the
        // endpoint's schema is strict.
        allocations: (proposal?.proposed ?? []).map((row) => ({ chargeId: row.chargeId, amountCents: row.amountCents })),
      }),
    onSuccess: onRecorded,
  })

  const canPropose = amountCents !== null && amountCents > 0 && receivedOn !== ''

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canPropose || amountCents === null) return
        if (proposal === null) propose.mutate(amountCents)
        else confirm.mutate(amountCents)
      }}
    >
      <MoneyInput
        required
        label={t('billing:payment.amountCents.label')}
        onValueChange={(cents) => {
          setAmountCents(cents)
          resetProposal()
        }}
      />
      <Input
        type="date"
        required
        label={t('billing:payment.receivedOn.label')}
        value={receivedOn}
        onChange={(event) => {
          setReceivedOn(event.target.value)
          resetProposal()
        }}
      />
      <Select
        label={t('billing:payment.method.label')}
        value={method}
        onChange={(event) => setMethod(event.target.value as PaymentMethod)}
      >
        {PAYMENT_METHOD_VALUES.map((value) => (
          <option key={value} value={value}>
            {t(`domain:paymentMethod.${value}`)}
          </option>
        ))}
      </Select>

      <ErrorMessage error={propose.error} />

      {proposal !== null && (
        <div className="flex flex-col gap-2">
          <DataList>
            {proposal.proposed.map((allocation) => (
              <DataList.Row
                key={allocation.chargeId}
                label={
                  <span>
                    {allocation.description}
                    {allocation.dueOn !== null && <span className="text-muted"> · {formatDate(allocation.dueOn, locale)}</span>}
                  </span>
                }
                value={<Money cents={allocation.amountCents} />}
              />
            ))}
          </DataList>
          {proposal.excessCents > 0 && (
            <p className="text-xs text-muted">
              {t('billing:payment.excess', { amount: formatCurrency(proposal.excessCents, locale) })}
            </p>
          )}
        </div>
      )}

      <ErrorMessage error={confirm.error} />

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        {proposal === null ? (
          <Button key="propose" variant="primary" type="submit" isLoading={propose.isPending} disabled={!canPropose}>
            {t('billing:payment.propose')}
          </Button>
        ) : (
          <Button key="confirm" variant="primary" type="submit" isLoading={confirm.isPending}>
            {t('billing:payment.confirm')}
          </Button>
        )}
      </Dialog.Footer>
    </form>
  )
}
