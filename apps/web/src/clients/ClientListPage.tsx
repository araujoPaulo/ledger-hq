import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Plus, Search, SearchX, Users } from 'lucide-react'
import { CLIENT_KIND_VALUES } from '@ledger-hq/domain'
import type { ClientKind } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Badge, Button, Card, Checkbox, DataList, EmptyState, Input, PageHeader, Select } from '../ui'
import { listClients } from './api'
import type { ClientFilters, ClientResponse } from './api'
import { ClientListSkeleton } from './ClientListSkeleton'
import { KIND_TONE } from './kindTone'

/**
 * Whether an empty result means "nothing matches" rather than "no clients".
 * "Show archived" alone is not a filter: with it on and nothing back, there
 * are no clients at all. Nor is a search of only spaces — the server trims it
 * to nothing.
 */
function isFiltered(filters: ClientFilters): boolean {
  return (filters.search ?? '').trim() !== '' || filters.kind !== undefined
}

function CreateClientButton({ className }: { className?: string }) {
  const { t } = useTranslation('common')

  return (
    <Button asChild variant="primary" {...(className === undefined ? {} : { className })}>
      <Link to="/clients/new">
        <Plus aria-hidden="true" className="h-4 w-4" />
        {t('actions.create')}
      </Link>
    </Button>
  )
}

function ClientRow({ client }: { client: ClientResponse }) {
  const { t } = useTranslation(['clients', 'domain'])
  const archived = client.archivedAt !== null

  return (
    <DataList.Row
      label={
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <Link
              to="/clients/$clientId"
              params={{ clientId: client.id }}
              className={`truncate font-medium${archived ? ' text-muted' : ''}`}
            >
              {client.name}
            </Link>
            {archived && <Badge tone="neutral">{t('clients:archived')}</Badge>}
          </span>
          <span className="text-xs text-muted tabular-nums md:hidden">{client.taxId}</span>
        </span>
      }
      value={
        <>
          <span className="hidden text-muted tabular-nums md:inline">{client.taxId}</span>
          <Badge tone={KIND_TONE[client.kind]}>{t(`domain:clientKind.${client.kind}`)}</Badge>
        </>
      }
    />
  )
}

export function ClientListPage() {
  const { t } = useTranslation(['clients', 'common', 'domain'])
  const [filters, setFilters] = useState<ClientFilters>({})

  const clients = useQuery({
    queryKey: ['clients', filters],
    queryFn: () => listClients(filters),
    placeholderData: keepPreviousData,
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('clients:title')} actions={<CreateClientButton className="w-full sm:w-auto" />} />

      <div className="flex flex-wrap items-center gap-4">
        <div className="w-full sm:w-auto sm:max-w-[360px] sm:flex-1">
          <Input
            type="search"
            leadingIcon={Search}
            hideLabel
            label={t('clients:filter.search')}
            placeholder={t('clients:filter.search')}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
          />
        </div>

        <Select
          layout="inline"
          label={t('clients:form.kind.label')}
          onChange={(event) => {
            const value = event.target.value
            setFilters((current) => {
              // exactOptionalPropertyTypes forbids setting an optional
              // property to `undefined`; omit the key instead to clear it.
              const { kind: _kind, ...rest } = current
              return value === '' ? rest : { ...rest, kind: value as ClientKind }
            })
          }}
        >
          <option value="">{t('clients:filter.all')}</option>
          {CLIENT_KIND_VALUES.map((kind) => (
            <option key={kind} value={kind}>
              {t(`domain:clientKind.${kind}`)}
            </option>
          ))}
        </Select>

        <Checkbox
          boxed
          label={t('clients:filter.showArchived')}
          onChange={(event) => setFilters((current) => ({ ...current, includeArchived: event.target.checked }))}
        />

        {/* Only once data exists, so it never reads "0" during the first load. */}
        {clients.data !== undefined && (
          <p className="ml-auto text-xs text-muted tabular-nums">
            {t('clients:count', { count: clients.data.length })}
          </p>
        )}
      </div>

      {/*
       * Without this split, a genuine fetch failure (`data` stays
       * `undefined`) would fall through to the `data?.length === 0` empty
       * state or an empty `.map()` — indistinguishable from "this client
       * truly has none yet". Same class of bug already fixed, with the
       * same reasoning, in FiscalProfileForm/ClientDetailPage and
       * AddEmploymentForm. `isPending` is true only for the first load:
       * `keepPreviousData` keeps the previous rows on screen while a filter
       * change fetches, rather than flashing the skeleton.
       */}
      {clients.isError ? (
        <ErrorMessage error={clients.error} />
      ) : clients.isPending ? (
        <ClientListSkeleton />
      ) : clients.data.length === 0 ? (
        isFiltered(filters) ? (
          <EmptyState icon={SearchX} title={t('clients:noMatches')} description={t('clients:noMatchesHint')} />
        ) : (
          <EmptyState
            icon={Users}
            title={t('clients:empty')}
            description={t('clients:emptyHint')}
            action={<CreateClientButton />}
          />
        )
      ) : (
        <Card padding="none" className="px-5">
          <DataList>
            {clients.data.map((client) => (
              <ClientRow key={client.id} client={client} />
            ))}
          </DataList>
        </Card>
      )}
    </div>
  )
}
