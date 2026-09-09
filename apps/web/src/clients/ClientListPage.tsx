import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CLIENT_KIND_VALUES } from '@ledger-hq/domain'
import type { ClientKind } from '@ledger-hq/domain'
import { listClients } from './api'
import type { ClientFilters } from './api'

export function ClientListPage() {
  const { t } = useTranslation(['clients', 'common', 'domain'])
  const [filters, setFilters] = useState<ClientFilters>({})

  const clients = useQuery({
    queryKey: ['clients', filters],
    queryFn: () => listClients(filters),
    placeholderData: keepPreviousData,
  })

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t('clients:title')}</h1>
        <Link to="/clients/new" className="rounded bg-slate-900 px-3 py-2 text-sm text-white">
          {t('common:actions.create')}
        </Link>
      </header>

      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          placeholder={t('clients:filter.search')}
          onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        />

        <label className="flex items-center gap-2 text-sm">
          {t('clients:form.kind.label')}
          <select
            onChange={(event) => {
              const value = event.target.value
              setFilters((current) => {
                // exactOptionalPropertyTypes forbids setting an optional
                // property to `undefined`; omit the key instead to clear it.
                const { kind: _kind, ...rest } = current
                return value === '' ? rest : { ...rest, kind: value as ClientKind }
              })
            }}
            className="rounded border border-slate-300 px-2 py-1"
          >
            <option value="">{t('clients:filter.all')}</option>
            {CLIENT_KIND_VALUES.map((kind) => (
              <option key={kind} value={kind}>
                {t(`domain:clientKind.${kind}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            onChange={(event) =>
              setFilters((current) => ({ ...current, includeArchived: event.target.checked }))
            }
          />
          {t('clients:filter.showArchived')}
        </label>
      </div>

      {clients.data?.length === 0 ? (
        <p className="text-sm text-slate-600">{t('clients:empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {clients.data?.map((client) => (
            <li key={client.id} className="flex items-center justify-between px-4 py-3">
              <Link to="/clients/$clientId" params={{ clientId: client.id }} className="font-medium">
                {client.name}
              </Link>
              <span className="text-xs uppercase tracking-wide text-slate-500">
                {t(`domain:clientKind.${client.kind}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
