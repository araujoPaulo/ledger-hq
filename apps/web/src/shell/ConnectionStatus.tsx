import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { WifiOff } from 'lucide-react'
import { Badge } from '../ui'
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

  // The last-sync line stays inside the same role="status" element, visually
  // hidden: a screen reader still hears it, and the pill stays pill-sized
  // instead of growing into the banner this used to be.
  return (
    <Badge shape="pill" tone="danger" role="status">
      <WifiOff aria-hidden="true" className="h-3.5 w-3.5" />
      {t('connection.offline')}
      {time === '' ? null : <span className="sr-only">{t('connection.lastSync', { time })}</span>}
    </Badge>
  )
}
