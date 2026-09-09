import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ClientKind } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { endEmployment, listEmployments } from './api'
import { AddEmploymentForm } from './AddEmploymentForm'

type Props = { client: { id: string; kind: ClientKind; name: string } }

/** Today, as an ISO calendar date — used as the end date for the "end employment" action. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function EmploymentSection({ client }: Props) {
  const { t, i18n } = useTranslation(['employments', 'common'])
  const locale = i18n.language as SupportedLocale
  const queryClient = useQueryClient()
  const isCompany = client.kind === 'COMPANY'

  const employments = useQuery({
    queryKey: ['employments', client.id],
    queryFn: () => listEmployments(client.id),
  })

  const endMutation = useMutation({
    mutationFn: (id: string) => endEmployment(id, today()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employments', client.id] })
    },
  })

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">
        {isCompany ? t('employments:employeesTitle') : t('employments:employmentsTitle')}
      </h2>

      {/*
       * Loading, a genuine fetch failure and "no spells yet" are three
       * distinct branches below, checked in that order — not a single
       * `data?.length === 0` collapse that would render a fetch failure
       * identically to an empty list.
       */}
      {employments.isPending ? null : employments.isError ? (
        <ErrorMessage error={employments.error} />
      ) : employments.data.length === 0 ? (
        <p className="text-sm text-slate-600">{t('employments:empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {employments.data.map((spell) => {
            const counterpartyName = isCompany ? spell.employeeName : spell.employerName
            const isOpen = spell.endedOn === null

            return (
              <li key={spell.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                {/*
                 * A plain span, not a router `Link`: this section is also
                 * exercised by EmploymentSection.test.tsx without a
                 * RouterProvider ancestor, and no requirement calls for
                 * navigating to the counterparty's own page from here.
                 */}
                <span className="font-medium">{counterpartyName}</span>
                <span className="text-slate-600">{spell.jobTitle}</span>
                <span className="text-slate-600">
                  {formatDate(spell.startedOn, locale)}
                  {spell.endedOn === null ? '' : ` – ${formatDate(spell.endedOn, locale)}`}
                </span>
                {isOpen ? (
                  <span className="flex items-center gap-2">
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                      {t('employments:current')}
                    </span>
                    <button
                      type="button"
                      onClick={() => endMutation.mutate(spell.id)}
                      disabled={endMutation.isPending}
                      className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      {t('employments:end')}
                    </button>
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <ErrorMessage error={endMutation.error} />

      <AddEmploymentForm client={client} />
    </section>
  )
}
