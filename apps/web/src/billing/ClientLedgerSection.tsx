import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatCurrency } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { getClientLedger } from './api'
import { RetainerPlanForm } from './RetainerPlanForm'

export function ClientLedgerSection({ clientId }: { clientId: string }) {
  const { t, i18n } = useTranslation(['billing', 'common'])
  const queryClient = useQueryClient()
  const [showPlanForm, setShowPlanForm] = useState(false)

  const ledger = useQuery({ queryKey: ['client-ledger', clientId], queryFn: () => getClientLedger(clientId) })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['client-ledger', clientId] })

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t('billing:ledger.title')}</h2>
        <button
          type="button"
          onClick={() => setShowPlanForm((value) => !value)}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          {t('common:actions.edit')}
        </button>
      </div>

      {showPlanForm && (
        <RetainerPlanForm
          clientId={clientId}
          currentPlan={null}
          onSaved={() => {
            setShowPlanForm(false)
            invalidate()
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
                <span className={entry.amountCents < 0 ? 'text-green-700' : ''}>
                  {formatCurrency(entry.amountCents, i18n.language as SupportedLocale)}
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
    </section>
  )
}
