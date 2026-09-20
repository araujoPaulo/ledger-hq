import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PAYMENT_METHOD_VALUES } from '@ledger-hq/domain'
import type { PaymentMethod } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatCurrency } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { proposeAllocation, recordPayment } from './api'
import type { ProposedAllocation } from './api'

type Props = { clientId: string; onRecorded: () => void }

export function RecordPaymentForm({ clientId, onRecorded }: Props) {
  const { t, i18n } = useTranslation(['billing', 'domain', 'common'])
  const [amountCents, setAmountCents] = useState('')
  const [receivedOn, setReceivedOn] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('TRANSFER')
  const [proposal, setProposal] = useState<{ proposed: ProposedAllocation[]; excessCents: number } | null>(null)

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
        allocations: proposal?.proposed ?? [],
      }),
    onSuccess: () => {
      setAmountCents('')
      setReceivedOn('')
      setProposal(null)
      onRecorded()
    },
  })

  return (
    <div className="flex max-w-sm flex-col gap-3">
      <h3 className="font-medium">{t('billing:payment.recordTitle')}</h3>

      <label className="flex flex-col gap-1 text-sm">
        {t('billing:payment.amountCents.label')}
        <input
          type="number"
          required
          min={1}
          value={amountCents}
          onChange={(event) => setAmountCents(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('billing:payment.receivedOn.label')}
        <input
          type="date"
          required
          value={receivedOn}
          onChange={(event) => setReceivedOn(event.target.value)}
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
                <span>{allocation.chargeId}</span>
                <span>{allocation.amountCents}</span>
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
    </div>
  )
}
