import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatCurrency } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { getClientLedger, getCurrentRetainerPlan, writeOffCharge } from './api'
import { AddAdHocChargeForm } from './AddAdHocChargeForm'
import { RecordPaymentForm } from './RecordPaymentForm'
import { RetainerPlanForm } from './RetainerPlanForm'

export function ClientLedgerSection({ clientId }: { clientId: string }) {
  const { t, i18n } = useTranslation(['billing', 'common'])
  const queryClient = useQueryClient()
  const titleId = useId()
  const [showPlanForm, setShowPlanForm] = useState(false)
  const [writingOffChargeId, setWritingOffChargeId] = useState<string | null>(null)
  const [writeOffReason, setWriteOffReason] = useState('')

  const ledger = useQuery({ queryKey: ['client-ledger', clientId], queryFn: () => getClientLedger(clientId) })
  const currentPlan = useQuery({ queryKey: ['current-retainer-plan', clientId], queryFn: () => getCurrentRetainerPlan(clientId) })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['client-ledger', clientId] })

  const writeOff = useMutation({
    mutationFn: () => writeOffCharge(writingOffChargeId!, writeOffReason),
    onSuccess: () => {
      setWritingOffChargeId(null)
      setWriteOffReason('')
      invalidate()
    },
  })

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id={titleId} className="text-base font-semibold">
          {t('billing:ledger.title')}
        </h2>
        <button
          type="button"
          onClick={() => setShowPlanForm((value) => !value)}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          {t('common:actions.edit')}
        </button>
      </div>

      {showPlanForm && currentPlan.data !== undefined && (
        <RetainerPlanForm
          clientId={clientId}
          currentPlan={currentPlan.data}
          onSaved={() => {
            setShowPlanForm(false)
            invalidate()
            queryClient.invalidateQueries({ queryKey: ['current-retainer-plan', clientId] })
          }}
        />
      )}

      {ledger.isPending ? null : ledger.isError ? (
        <ErrorMessage error={ledger.error} />
      ) : ledger.data.entries.length === 0 ? (
        <p className="text-sm text-slate-600">{t('billing:ledger.empty')}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {ledger.data.entries.map((entry, index) => (
              <li key={index} className="flex items-center justify-between text-sm">
                <span>{entry.description}</span>
                <span className="flex items-center gap-2">
                  <span className={entry.amountCents < 0 ? 'text-green-700' : ''}>
                    {formatCurrency(entry.amountCents, i18n.language as SupportedLocale)}
                  </span>
                  {entry.type === 'CHARGE' && entry.chargeId !== null && !entry.writtenOff && (
                    writingOffChargeId === entry.chargeId ? (
                      <span className="flex items-center gap-1">
                        <input
                          value={writeOffReason}
                          onChange={(event) => setWriteOffReason(event.target.value)}
                          placeholder={t('billing:writeOff.reason.label')}
                          className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => writeOff.mutate()}
                          disabled={writeOffReason.trim() === '' || writeOff.isPending}
                          className="text-xs text-red-700 underline disabled:opacity-50"
                        >
                          {t('common:actions.save')}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setWritingOffChargeId(entry.chargeId)}
                        className="text-xs text-red-700 underline"
                      >
                        {t('billing:writeOff.action')}
                      </button>
                    )
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm font-medium">
            <span>{t('billing:ledger.balance')}</span>
            <span>{formatCurrency(ledger.data.balanceCents, i18n.language as SupportedLocale)}</span>
          </div>
        </>
      )}

      <ErrorMessage error={writeOff.error} />

      <RecordPaymentForm clientId={clientId} onRecorded={invalidate} />

      <AddAdHocChargeForm clientId={clientId} onCreated={invalidate} />
    </section>
  )
}
