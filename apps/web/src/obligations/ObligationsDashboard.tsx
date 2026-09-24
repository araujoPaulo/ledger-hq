import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CircleCheck } from 'lucide-react'
import { groupByUrgency } from '@ledger-hq/domain'
import type { UrgencyGroup } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Badge, EmptyState } from '../ui'
import { listObligations, patchObligation } from './api'
import { ObligationRow } from './ObligationRow'
import { ObligationsDashboardSkeleton } from './ObligationsDashboardSkeleton'
import { URGENCY_TONE } from './urgencyTone'

const SECTIONS: UrgencyGroup[] = ['overdue', 'thisWeek', 'thisMonth', 'later']

export function ObligationsDashboard() {
  const { t } = useTranslation('obligations')
  const queryClient = useQueryClient()

  const obligations = useQuery({ queryKey: ['obligations'], queryFn: () => listObligations() })

  const markDone = useMutation({
    mutationFn: (id: string) => patchObligation(id, { status: 'DONE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['obligations'] }),
  })

  if (obligations.isPending) return <ObligationsDashboardSkeleton />
  if (obligations.isError) return <ErrorMessage error={obligations.error} />

  if (obligations.data.length === 0) {
    return (
      <section className="flex flex-col gap-4">
        {/* The page's own PageHeader owns the h1; this is a section of it. */}
        <h2 className="text-lg font-semibold">{t('dashboard.title')}</h2>
        <EmptyState
          icon={CircleCheck}
          title={t('dashboard.empty')}
          description={t('dashboard.emptyHint')}
        />
      </section>
    )
  }

  const groups = groupByUrgency(obligations.data, new Date())

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('dashboard.title')}</h2>

      <ErrorMessage error={markDone.error} />

      {SECTIONS.filter((key) => groups[key].length > 0).map((key) => (
        <div key={key} className="flex flex-col gap-2">
          {/* The badge's tone is the same one its summary tile carries, which
              is what ties the count above to the list below. */}
          <Badge tone={URGENCY_TONE[key]} className="self-start">
            {t(`dashboard.${key}`)} · {groups[key].length}
          </Badge>
          {/* No Card wrapper: ObligationRow draws its own bordered surface,
              and Stage 1 leaves that row untouched. */}
          <ul className="flex flex-col gap-2">
            {groups[key].map((obligation) => (
              <ObligationRow
                key={obligation.id}
                obligation={obligation}
                showClient
                onMarkDone={() => markDone.mutate(obligation.id)}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
