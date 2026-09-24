import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { groupByUrgency } from '@ledger-hq/domain'
import type { UrgencyGroup } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { listObligations, patchObligation } from './api'
import { ObligationRow } from './ObligationRow'

const SECTIONS: UrgencyGroup[] = ['overdue', 'thisWeek', 'thisMonth', 'later']

export function ObligationsDashboard() {
  const { t } = useTranslation('obligations')
  const queryClient = useQueryClient()

  const obligations = useQuery({ queryKey: ['obligations'], queryFn: () => listObligations() })

  const markDone = useMutation({
    mutationFn: (id: string) => patchObligation(id, { status: 'DONE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['obligations'] }),
  })

  if (obligations.isPending) return null
  if (obligations.isError) return <ErrorMessage error={obligations.error} />

  if (obligations.data.length === 0) {
    return (
      <section className="flex flex-col gap-6">
        <h1 className="text-lg font-semibold">{t('dashboard.title')}</h1>
        <p className="text-sm text-slate-600">{t('dashboard.empty')}</p>
      </section>
    )
  }

  const groups = groupByUrgency(obligations.data, new Date())

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">{t('dashboard.title')}</h1>

      <ErrorMessage error={markDone.error} />

      {SECTIONS.filter((key) => groups[key].length > 0).map((key) => (
        <div key={key}>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">{t(`dashboard.${key}`)}</h2>
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
