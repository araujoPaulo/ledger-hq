import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Plus, Users } from 'lucide-react'
import type { ClientKind } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Badge, Button, Card, DataList, Dialog, EmptyState, Skeleton } from '../ui'
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
  const titleId = useId()
  const isCompany = client.kind === 'COMPANY'
  const [adding, setAdding] = useState(false)

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
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id={titleId} className="text-base font-semibold">
          {isCompany ? t('employments:employeesTitle') : t('employments:employmentsTitle')}
        </h2>
        <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          {t('employments:add')}
        </Button>
      </div>

      {/*
       * Loading, a genuine fetch failure and "no spells yet" are three
       * distinct branches below, checked in that order — not a single
       * `data?.length === 0` collapse that would render a fetch failure
       * identically to an empty list.
       */}
      {employments.isPending ? (
        <Card padding="none" className="flex flex-col px-5" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex min-h-[44px] items-center justify-between gap-4 border-b border-line py-3 last:border-b-0">
              <Skeleton width="12rem" height="0.875rem" />
              <Skeleton width="8rem" height="0.875rem" />
            </div>
          ))}
        </Card>
      ) : employments.isError ? (
        <ErrorMessage error={employments.error} />
      ) : employments.data.length === 0 ? (
        <EmptyState icon={Users} title={t('employments:empty')} description={t('employments:emptyHint')} />
      ) : (
        <Card padding="none" className="px-5">
          <DataList>
            {employments.data.map((spell) => {
              const counterpartyId = isCompany ? spell.employeeId : spell.employerId
              const counterpartyName = isCompany ? spell.employeeName : spell.employerName
              const isOpen = spell.endedOn === null

              return (
                <DataList.Row
                  key={spell.id}
                  label={
                    <span className="flex min-w-0 flex-col">
                      <Link to="/clients/$clientId" params={{ clientId: counterpartyId }} className="truncate font-medium">
                        {counterpartyName}
                      </Link>
                      {spell.jobTitle !== null && <span className="text-xs text-muted">{spell.jobTitle}</span>}
                    </span>
                  }
                  value={
                    <>
                      <span className="text-muted tabular-nums">
                        {formatDate(spell.startedOn, locale)}
                        {spell.endedOn === null ? '' : ` – ${formatDate(spell.endedOn, locale)}`}
                      </span>
                      {isOpen && (
                        <>
                          <Badge tone="success">{t('employments:current')}</Badge>
                          <Button
                            variant="secondary"
                            size="sm"
                            isLoading={endMutation.isPending && endMutation.variables === spell.id}
                            onClick={() => endMutation.mutate(spell.id)}
                          >
                            {t('employments:end')}
                          </Button>
                        </>
                      )}
                    </>
                  }
                />
              )
            })}
          </DataList>
        </Card>
      )}

      <ErrorMessage error={endMutation.error} />

      <Dialog open={adding} onOpenChange={setAdding}>
        <Dialog.Content title={t('employments:add')}>
          <AddEmploymentForm client={client} onAdded={() => setAdding(false)} />
        </Dialog.Content>
      </Dialog>
    </section>
  )
}
