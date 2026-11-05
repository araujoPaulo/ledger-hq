import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { groupByUrgency } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Badge, Tabs } from '../ui'
import { ClientLedgerSection } from '../billing/ClientLedgerSection'
import { EmploymentSection } from '../employments/EmploymentSection'
import { ObligationsSection } from '../obligations/ObligationsSection'
import { listObligations } from '../obligations/api'
import { CredentialsSection } from '../vault/CredentialsSection'
import { useVaultState } from '../vault/vault-session'
import { getClient } from './api'
import { ClientDetailSkeleton } from './ClientDetailSkeleton'
import { ClientHeader } from './ClientHeader'
import { ClientOverviewTab } from './ClientOverviewTab'
import { isClientTab } from './clientTabs'

/**
 * A header and five tabs. Only the active tab is mounted, so each tab's
 * queries run when it is opened — except what Overview's summary needs, which
 * Overview fetches under the Obligations and Billing tabs' own keys.
 */
export function ClientDetailPage() {
  const { clientId } = useParams({ from: '/clients/$clientId' })
  const search = useSearch({ from: '/clients/$clientId' })
  // Guard here too: the router can hand an unvalidated `?tab=` through, and a
  // stale value must open Overview rather than an empty strip.
  const tab = isClientTab(search.tab) ? search.tab : 'overview'
  const navigate = useNavigate()
  const { t } = useTranslation(['clients', 'employments'])
  const vaultState = useVaultState()

  const client = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => getClient(clientId),
  })

  // Read from the cache only, for the tab badge: Overview and the Obligations
  // tab fetch this key; the badge never fetches it on its own.
  const obligations = useQuery({
    queryKey: ['obligations', clientId],
    queryFn: () => listObligations({ clientId }),
    enabled: false,
  })

  if (client.isPending) return <ClientDetailSkeleton />
  if (client.isError) return <ErrorMessage error={client.error} />

  const record = client.data
  const overdue = obligations.data === undefined ? 0 : groupByUrgency(obligations.data, new Date()).overdue.length

  function selectTab(next: string) {
    if (!isClientTab(next)) return
    // replace: Back leaves the client rather than walking the tabs clicked
    // through. Overview is the default, so it keeps a clean URL.
    void navigate({
      to: '/clients/$clientId',
      params: { clientId },
      search: next === 'overview' ? {} : { tab: next },
      replace: true,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <ClientHeader client={record} />

      <Tabs value={tab} onValueChange={selectTab} className="flex flex-col gap-6">
        <Tabs.List>
          <Tabs.Trigger value="overview">{t('clients:tabs.overview')}</Tabs.Trigger>
          <Tabs.Trigger value="obligations">
            {t('clients:tabs.obligations')}
            {overdue > 0 && <Badge tone="danger">{overdue}</Badge>}
          </Tabs.Trigger>
          <Tabs.Trigger value="billing">{t('clients:tabs.billing')}</Tabs.Trigger>
          <Tabs.Trigger value="people">
            {record.kind === 'COMPANY' ? t('employments:employeesTitle') : t('employments:employmentsTitle')}
          </Tabs.Trigger>
          <Tabs.Trigger value="credentials">
            {t('clients:tabs.credentials')}
            {vaultState.status === 'locked' && <Lock aria-hidden="true" className="h-3.5 w-3.5 text-subtle" />}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview">
          <ClientOverviewTab client={record} />
        </Tabs.Content>
        <Tabs.Content value="obligations">
          <ObligationsSection clientId={clientId} />
        </Tabs.Content>
        <Tabs.Content value="billing">
          <ClientLedgerSection clientId={clientId} />
        </Tabs.Content>
        <Tabs.Content value="people">
          <EmploymentSection client={{ id: record.id, kind: record.kind, name: record.name }} />
        </Tabs.Content>
        <Tabs.Content value="credentials">
          <CredentialsSection clientId={clientId} />
        </Tabs.Content>
      </Tabs>
    </div>
  )
}
