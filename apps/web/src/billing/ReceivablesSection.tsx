import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { getReceivables } from './api'
import { formatCurrency } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'

export function ReceivablesSection() {
  const { t, i18n } = useTranslation('billing')

  const receivables = useQuery({ queryKey: ['receivables'], queryFn: getReceivables })

  if (receivables.isPending) return null
  if (receivables.isError) return <ErrorMessage error={receivables.error} />

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t('receivables.title')}</h2>

      {receivables.data.length === 0 ? (
        <p className="text-sm text-slate-600">{t('receivables.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {receivables.data.map((row) => (
            <li key={row.clientId} className="flex items-center justify-between rounded border border-slate-200 bg-white p-3 text-sm">
              <span>{row.clientName}</span>
              <span className="flex items-center gap-3">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{t(`receivables.bucket.${row.ageingBucket}`)}</span>
                <span className="font-medium">{formatCurrency(row.outstandingCents, i18n.language as SupportedLocale)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
