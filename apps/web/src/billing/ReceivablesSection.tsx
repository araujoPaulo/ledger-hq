import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Coins } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Badge, Card, DataList, EmptyState, Money } from '../ui'
import { getReceivables } from './api'
import { AGEING_TONE } from './ageingTone'
import { ReceivablesSectionSkeleton } from './ReceivablesSectionSkeleton'

export function ReceivablesSection() {
  const { t } = useTranslation('billing')

  const receivables = useQuery({ queryKey: ['receivables'], queryFn: getReceivables })

  if (receivables.isPending) return <ReceivablesSectionSkeleton />
  // See ObligationsDashboard: the heading stays, so two identical error
  // sentences on one page are still attributable.
  if (receivables.isError) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t('receivables.title')}</h2>
        <ErrorMessage error={receivables.error} />
      </section>
    )
  }

  const total = receivables.data.reduce((sum, row) => sum + row.outstandingCents, 0)

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('receivables.title')}</h2>

      {receivables.data.length === 0 ? (
        <EmptyState icon={Coins} title={t('receivables.empty')} description={t('receivables.emptyHint')} />
      ) : (
        <Card padding="none" className="px-5">
          <DataList>
            {receivables.data.map((row) => (
              <DataList.Row
                key={row.clientId}
                label={
                  // Following a receivable to its client is the only thing
                  // anyone does from this list.
                  <Link to="/clients/$clientId" params={{ clientId: row.clientId }} className="font-medium">
                    {row.clientName}
                  </Link>
                }
                value={
                  <>
                    <Badge tone={AGEING_TONE[row.ageingBucket]}>
                      {t(`receivables.bucket.${row.ageingBucket}`)}
                    </Badge>
                    <Money cents={row.outstandingCents} />
                  </>
                }
              />
            ))}
            {/* The tile above summarises the page; this is the foot of a
                ledger. A column of amounts that does not add up on screen
                invites someone to add it up by hand. */}
            <DataList.Total label={t('receivables.title')} value={<Money cents={total} />} />
          </DataList>
        </Card>
      )}
    </section>
  )
}
