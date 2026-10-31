import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Periodicity } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Button, Card, DataList, Dialog, Money, Skeleton } from '../ui'
import { getCurrentRetainerPlan } from './api'
import { RetainerPlanForm } from './RetainerPlanForm'

type Props = { clientId: string; onSaved: () => void }

export function RetainerPlanCard({ clientId, onSaved }: Props) {
  const { t, i18n } = useTranslation(['billing', 'domain'])
  const locale = i18n.language as SupportedLocale
  const queryClient = useQueryClient()
  const titleId = useId()
  const [editing, setEditing] = useState(false)

  const plan = useQuery({ queryKey: ['current-retainer-plan', clientId], queryFn: () => getCurrentRetainerPlan(clientId) })
  const actionLabel = plan.data === null ? t('billing:retainerPlan.createTitle') : t('billing:retainerPlan.renewTitle')

  return (
    <section aria-labelledby={titleId}>
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-base font-semibold">
            {t('billing:retainerPlan.title')}
          </h2>
          {plan.data !== undefined && (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              {actionLabel}
            </Button>
          )}
        </div>

        {plan.isPending ? (
          <Skeleton height="4rem" />
        ) : plan.isError ? (
          <ErrorMessage error={plan.error} />
        ) : plan.data === null ? (
          <p className="text-sm text-muted">{t('billing:retainerPlan.none')}</p>
        ) : (
          <DataList as="dl">
            <DataList.Row label={t('billing:retainerPlan.amountCents.label')} value={<Money cents={plan.data.amountCents} />} />
            <DataList.Row
              label={t('billing:retainerPlan.periodicity.label')}
              value={t(`domain:periodicity.${plan.data.periodicity as Periodicity}`)}
            />
            <DataList.Row
              label={t('billing:retainerPlan.dueDayOfMonth.label')}
              value={<span className="tabular-nums">{plan.data.dueDayOfMonth}</span>}
            />
            <DataList.Row
              label={t('billing:retainerPlan.validFrom.label')}
              value={<span className="tabular-nums">{formatDate(plan.data.validFrom.slice(0, 10), locale)}</span>}
            />
          </DataList>
        )}
      </Card>

      <Dialog open={editing} onOpenChange={setEditing}>
        {plan.data !== undefined && (
          <Dialog.Content title={actionLabel}>
            <RetainerPlanForm
              clientId={clientId}
              currentPlan={plan.data}
              onSaved={() => {
                setEditing(false)
                void queryClient.invalidateQueries({ queryKey: ['current-retainer-plan', clientId] })
                onSaved()
              }}
            />
          </Dialog.Content>
        )}
      </Dialog>
    </section>
  )
}
