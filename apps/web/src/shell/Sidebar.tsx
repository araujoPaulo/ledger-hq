import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, Users, Vault } from 'lucide-react'
import { AccountMenu } from './AccountMenu'

// "Deadlines" reuses the obligations dashboard's own title rather than adding
// a nav key that would say the same word twice.
const DESTINATIONS = [
  { to: '/', labelKey: 'obligations:dashboard.title', icon: CalendarCheck },
  { to: '/clients', labelKey: 'common:nav.clients', icon: Users },
  { to: '/vault/platforms', labelKey: 'common:nav.vault', icon: Vault },
] as const

export function Sidebar() {
  const { t } = useTranslation(['common', 'obligations'])

  return (
    <nav
      aria-label={t('common:appName')}
      className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-8 overflow-y-auto border-r border-line bg-surface p-4 md:flex"
    >
      <span className="flex items-center gap-2.5 px-2 text-base font-semibold tracking-tight">
        <span className="flex h-6 w-6 items-center justify-center rounded-control bg-accent-600 text-xs font-semibold text-white">
          L
        </span>
        {t('common:appName')}
      </span>

      <div className="flex flex-1 flex-col gap-1">
        {DESTINATIONS.map(({ to, labelKey, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === '/' }}
            className="flex items-center gap-2.5 rounded-surface px-2.5 py-2 text-sm font-medium text-muted hover:bg-ground"
            activeProps={{
              className:
                'flex items-center gap-2.5 rounded-surface bg-accent-50 px-2.5 py-2 text-sm font-medium text-accent-700',
              'aria-current': 'page',
            }}
          >
            <Icon aria-hidden="true" className="h-5 w-5" />
            {t(labelKey)}
          </Link>
        ))}
      </div>

      <AccountMenu />
    </nav>
  )
}
