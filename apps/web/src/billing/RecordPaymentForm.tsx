import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PAYMENT_METHOD_VALUES } from '@ledger-hq/domain'
import type { PaymentMethod } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatCurrency, formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { proposeAllocation, recordPayment } from './api'
import type { ProposedAllocationRow } from './api'

type Props = { clientId: string; onRecorded: () => void }

export function RecordPaymentForm({ clientId, onRecorded }: Props) {
  const { t, i18n } = useTranslation(['billing', 'domain', 'common'])
  const titleId = useId()
  const [amountCents, setAmountCents] = useState('')
  const [receivedOn, setReceivedOn] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('TRANSFER')
  const [proposal, setProposal] = useState<{ proposed: ProposedAllocationRow[]; excessCents: number } | null>(null)

  // A proposal is only valid for the amount it was built from. Editing the
  // amount (or the date) after proposing must retract it, or Confirmar would
  // post the new amount against the old allocations — recording, say, a
  // 150,00 € payment with 15,00 € allocated, silently.
  const resetProposal = () => setProposal(null)

  const propose = useMutation({
    mutationFn: () => proposeAllocation(clientId, Number(amountCents)),
    onSuccess: (result) => setProposal(result),
  })

  const confirm = useMutation({
    mutationFn: () =>
      recordPayment({
        clientId,
        amountCents: Number(amountCents),
        receivedOn,
        method,
        // Only the allocation half goes back on the wire; the description
        // and period the proposal carries are for the operator, and the
        // endpoint's schema is strict.
        allocations: (proposal?.proposed ?? []).map((row) => ({ chargeId: row.chargeId, amountCents: row.amountCents })),
      }),
    onSuccess: () => {
      setAmountCents('')
      setReceivedOn('')
      setProposal(null)
      onRecorded()
    },
  })

  return (
    <section aria-labelledby={titleId} className="flex max-w-sm flex-col gap-3">
      <h3 id={titleId} className="font-medium">
        {t('billing:payment.recordTitle')}
      </h3>

      <label className="flex flex-col gap-1 text-sm">
        {t('billing:payment.amountCents.label')}
        <input
          type="number"
          required
          min={1}
          value={amountCents}
          onChange={(event) => {
            setAmountCents(event.target.value)
            resetProposal()
          }}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('billing:payment.receivedOn.label')}
        <input
          type="date"
          required
          value={receivedOn}
          onChange={(event) => {
            setReceivedOn(event.target.value)
            resetProposal()
          }}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('billing:payment.method.label')}
        <select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)} className="rounded border border-slate-300 px-2 py-1">
          {PAYMENT_METHOD_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`domain:paymentMethod.${value}`)}
            </option>
          ))}
        </select>
      </label>

      <ErrorMessage error={propose.error} />

      {proposal === null ? (
        <button
          type="button"
          onClick={() => propose.mutate()}
          disabled={propose.isPending || amountCents === '' || receivedOn === ''}
          className="self-start rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {t('billing:payment.propose')}
        </button>
      ) : (
        <>
          <ul className="flex flex-col gap-1 rounded border border-slate-200 p-2 text-sm">
            {proposal.proposed.map((allocation) => (
              <li key={allocation.chargeId} className="flex items-center justify-between">
                <span>
                  {allocation.description}
                  {allocation.dueOn !== null && <span className="text-slate-500"> · {formatDate(allocation.dueOn, i18n.language as SupportedLocale)}</span>}
                </span>
                <span>{formatCurrency(allocation.amountCents, i18n.language as SupportedLocale)}</span>
              </li>
            ))}
          </ul>
          {proposal.excessCents > 0 && (
            <p className="text-xs text-slate-600">
              {t('billing:payment.excess', { amount: formatCurrency(proposal.excessCents, i18n.language as SupportedLocale) })}
            </p>
          )}
          <ErrorMessage error={confirm.error} />
          <button
            type="button"
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending}
            className="self-start rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {t('billing:payment.confirm')}
          </button>
        </>
      )}
    </section>
  )
}
