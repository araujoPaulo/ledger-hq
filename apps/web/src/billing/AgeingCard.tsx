import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Badge, Card, Money } from '../ui'
import { getReceivables } from './api'
import { AGEING_TONE } from './ageingTone'

/**
 * The client's own row of the receivables list — no new endpoint, and the
 * cache entry is usually warm from the Overview page. A settled client has no
 * row and no ageing, so the card is not rendered at all; nor while loading
 * or on a failure, since it repeats what the ledger already shows.
 */
export function AgeingCard({ clientId }: { clientId: string }) {
  const { t, i18n } = useTranslation('billing')
  const receivables = useQuery({ queryKey: ['receivables'], queryFn: getReceivables })

  const row = receivables.data?.find((candidate) => candidate.clientId === clientId)
  if (row === undefined) return null

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold">{t('ageing.title')}</h2>
        <Badge tone={AGEING_TONE[row.ageingBucket]}>{t(`receivables.bucket.${row.ageingBucket}`)}</Badge>
      </div>
      <Money cents={row.outstandingCents} size="lg" />
      <p className="text-xs text-muted">
        {t('ageing.oldest', { date: formatDate(row.oldestDueOn, i18n.language as SupportedLocale) })}
      </p>
    </Card>
  )
}
