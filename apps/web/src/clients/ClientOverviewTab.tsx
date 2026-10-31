import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { groupByUrgency } from '@ledger-hq/domain'
import type { LegalForm } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Card, DataList, Money, Skeleton } from '../ui'
import { getClientLedger } from '../billing/api'
import { listObligations } from '../obligations/api'
import type { ClientResponse } from './api'
import type { ClientTab } from './clientTabs'
import { FiscalProfileCard } from './FiscalProfileCard'

const LINK_CLASS = 'text-accent-700 hover:underline'

function DetailsCard({ client }: { client: ClientResponse }) {
  const { t, i18n } = useTranslation(['clients', 'domain'])
  const locale = i18n.language as SupportedLocale

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">{t('clients:details')}</h2>
      <DataList as="dl">
        <DataList.Row label={t('clients:form.taxId.label')} value={<span className="tabular-nums">{client.taxId}</span>} />
        <DataList.Row label={t('clients:form.accounting.label')} value={t(`domain:accounting.${client.accounting}`)} />
        {client.legalForm !== null && (
          // Guaranteed non-null only for a COMPANY, whose legalForm is always one of LEGAL_FORM_VALUES.
          <DataList.Row
            label={t('clients:form.legalForm.label')}
            value={t(`domain:legalForm.${client.legalForm as LegalForm}`)}
          />
        )}
        {client.socialSecurityNo !== null && (
          <DataList.Row
            label={t('clients:form.socialSecurityNo.label')}
            value={<span className="tabular-nums">{client.socialSecurityNo}</span>}
          />
        )}
        {client.dateOfBirth !== null && (
          <DataList.Row
            label={t('clients:form.dateOfBirth.label')}
            value={<span className="tabular-nums">{formatDate(client.dateOfBirth, locale)}</span>}
          />
        )}
        {client.email !== null && (
          <DataList.Row
            label={t('clients:form.email.label')}
            value={
              <a href={`mailto:${client.email}`} className={`truncate ${LINK_CLASS}`}>
                {client.email}
              </a>
            }
          />
        )}
        {client.phone !== null && (
          <DataList.Row
            label={t('clients:form.phone.label')}
            value={
              <a href={`tel:${client.phone.replace(/\s/g, '')}`} className={`tabular-nums ${LINK_CLASS}`}>
                {client.phone}
              </a>
            }
          />
        )}
      </DataList>
      {/* A paragraph does not fit a value slot. */}
      {client.notes !== null && <p className="whitespace-pre-line text-sm font-normal">{client.notes}</p>}
    </Card>
  )
}

function GlanceTile({
  clientId,
  tab,
  label,
  children,
}: {
  clientId: string
  tab: ClientTab
  label: string
  children: ReactNode
}) {
  return (
    <Link
      to="/clients/$clientId"
      params={{ clientId }}
      search={{ tab }}
      className="flex min-h-[44px] flex-col gap-1.5 rounded-surface border border-line p-4 hover:bg-ground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
    >
      <span className="text-sm font-medium text-muted">{label}</span>
      {children}
    </Link>
  )
}

function AtAGlance({ clientId }: { clientId: string }) {
  const { t } = useTranslation('clients')

  // The same keys the Obligations and Billing tabs read (spec §2.4), so
  // switching to either is instant.
  const obligations = useQuery({ queryKey: ['obligations', clientId], queryFn: () => listObligations({ clientId }) })
  const ledger = useQuery({ queryKey: ['client-ledger', clientId], queryFn: () => getClientLedger(clientId) })

  const groups = obligations.data === undefined ? undefined : groupByUrgency(obligations.data, new Date())
  const due = groups === undefined ? 0 : groups.overdue.length + groups.thisWeek.length
  const anyOverdue = groups !== undefined && groups.overdue.length > 0

  return (
    <Card className="flex flex-col gap-4 self-start">
      <h2 className="text-base font-semibold">{t('glance.title')}</h2>
      <div className="grid grid-cols-2 gap-4">
        <GlanceTile clientId={clientId} tab="obligations" label={t('glance.due')}>
          {obligations.isPending ? (
            <Skeleton width="2.5rem" height="2rem" />
          ) : obligations.isError ? (
            <ErrorMessage error={obligations.error} />
          ) : (
            <span className={['text-2xl font-semibold tabular-nums', anyOverdue && 'text-danger-700'].filter(Boolean).join(' ')}>
              {due}
            </span>
          )}
        </GlanceTile>
        <GlanceTile clientId={clientId} tab="billing" label={t('glance.balance')}>
          {ledger.isPending ? (
            <Skeleton width="6rem" height="2rem" />
          ) : ledger.isError ? (
            <ErrorMessage error={ledger.error} />
          ) : (
            <Money cents={ledger.data.balanceCents} size="lg" />
          )}
        </GlanceTile>
      </div>
    </Card>
  )
}

/** Details and fiscal profile on the left, At a glance on the right; one column on a phone. */
export function ClientOverviewTab({ client }: { client: ClientResponse }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <DetailsCard client={client} />
        <FiscalProfileCard clientId={client.id} kind={client.kind} />
      </div>
      <AtAGlance clientId={client.id} />
    </div>
  )
}
