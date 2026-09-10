import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from './useOnlineStatus'

/**
 * Staleness must be visible. A credential rotated two days ago, shown as
 * current with no warning, costs a quarter of an hour of failed logins.
 */
export function ConnectionStatus() {
  const { t, i18n } = useTranslation('common')
  const online = useOnlineStatus()
  const queryClient = useQueryClient()

  if (online) return null

  const lastUpdated = Math.max(
    0,
    ...queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.dataUpdatedAt),
  )

  const time =
    lastUpdated > 0
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(
          new Date(lastUpdated),
        )
      : ''

  return (
    <div role="status" className="bg-amber-100 px-4 py-2 text-sm text-amber-900">
      <span>{t('connection.offline')}</span>
      {time === '' ? null : <span className="ml-2">{t('connection.lastSync', { time })}</span>}
    </div>
  )
}
