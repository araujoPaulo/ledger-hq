import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, MoreHorizontal } from 'lucide-react'
import type { LegalForm } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Badge, Button, DropdownMenu } from '../ui'
import { archiveClient, restoreClient } from './api'
import type { ClientResponse } from './api'
import { KIND_TONE } from './kindTone'

/**
 * The page's only `<h1>`. Not a `PageHeader`: the meta line is richer than a
 * description string. Actions sit beside the name from md; below it, in a
 * menu, so the name keeps the width.
 */
export function ClientHeader({ client }: { client: ClientResponse }) {
  const { t } = useTranslation(['clients', 'common', 'domain'])
  const queryClient = useQueryClient()
  const archived = client.archivedAt !== null

  const archive = useMutation({
    mutationFn: () => archiveClient(client.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['client', client.id] })
    },
  })

  const restore = useMutation({
    mutationFn: () => restoreClient(client.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['client', client.id] })
    },
  })

  const meta = [
    // Guaranteed non-null only for a COMPANY, whose legalForm is always one of LEGAL_FORM_VALUES.
    client.legalForm === null ? null : t(`domain:legalForm.${client.legalForm as LegalForm}`),
    t(`domain:accounting.${client.accounting}`),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/clients"
        className="inline-flex items-center gap-1 self-start text-xs font-medium text-muted hover:text-ink"
      >
        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        {t('clients:title')}
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone={KIND_TONE[client.kind]}>{t(`domain:clientKind.${client.kind}`)}</Badge>
            <span className="tabular-nums">{client.taxId}</span>
            <span>{meta}</span>
            {archived && <Badge tone="neutral">{t('clients:archived')}</Badge>}
          </p>
        </div>

        <div className="hidden shrink-0 items-center gap-4 md:flex">
          {!archived && (
            <Button asChild variant="secondary">
              <Link to="/clients/$clientId/edit" params={{ clientId: client.id }}>
                {t('common:actions.edit')}
              </Link>
            </Button>
          )}
          {archived ? (
            <Button variant="secondary" onClick={() => restore.mutate()} isLoading={restore.isPending}>
              {t('common:actions.restore')}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => archive.mutate()} isLoading={archive.isPending}>
              {t('common:actions.archive')}
            </Button>
          )}
        </div>

        <div className="md:hidden">
          <DropdownMenu>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('clients:actions')}>
                <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {!archived && (
                <DropdownMenu.Item asChild>
                  <Link to="/clients/$clientId/edit" params={{ clientId: client.id }}>
                    {t('common:actions.edit')}
                  </Link>
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item onSelect={() => (archived ? restore.mutate() : archive.mutate())}>
                {archived ? t('common:actions.restore') : t('common:actions.archive')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        </div>
      </header>

      <ErrorMessage error={archive.error} />
      <ErrorMessage error={restore.error} />
    </div>
  )
}
