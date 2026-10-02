import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, ChartColumn, Search, Users, Vault } from 'lucide-react'
import { AccountMenu } from './AccountMenu'
import { ConnectionStatus } from './ConnectionStatus'

const DESTINATIONS = [
  { to: '/', labelKey: 'obligations:dashboard.title', icon: CalendarCheck },
  { to: '/clients', labelKey: 'common:nav.clients', icon: Users },
  { to: '/vault/platforms', labelKey: 'common:nav.vault', icon: Vault },
  { to: '/reporting', labelKey: 'common:nav.reporting', icon: ChartColumn },
] as const

export function MobileTopBar() {
  const { t } = useTranslation('common')

  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b border-line bg-surface px-4 md:hidden">
      {/*
       * The mark, not the product name: the page's own PageHeader carries the
       * title on mobile, and a second "Ledger HQ" text node in the DOM would
       * make every `getByText(/ledger hq/i)` ambiguous. `aria-label` names the
       * link without adding text to match.
       */}
      <Link
        to="/"
        aria-label={t('appName')}
        className="flex h-6 w-6 items-center justify-center rounded-control bg-accent-600 text-xs font-semibold text-white"
      >
        L
      </Link>
      <span className="flex items-center gap-2">
        {/* Icon-only, so it carries the label the desktop box shows. */}
        <Link
          to="/search"
          search={{ q: '' }}
          aria-label={t('search.label')}
          className="flex h-9 w-9 items-center justify-center rounded-surface text-muted"
        >
          <Search aria-hidden="true" className="h-5 w-5" />
        </Link>
        <ConnectionStatus />
        <AccountMenu />
      </span>
    </header>
  )
}

export function MobileTabBar() {
  const { t } = useTranslation(['common', 'obligations'])

  return (
    <nav
      aria-label={t('common:appName')}
      className="fixed inset-x-0 bottom-0 flex items-center border-t border-line bg-surface px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
    >
      {/* Icons only, so each tab carries the label its desktop twin shows. */}
      {DESTINATIONS.map(({ to, labelKey, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          aria-label={t(labelKey)}
          activeOptions={{ exact: to === '/' }}
          className="flex h-[52px] flex-1 items-center justify-center rounded-surface text-muted"
          activeProps={{
            className: 'flex h-[52px] flex-1 items-center justify-center rounded-surface text-accent-700',
            'aria-current': 'page',
          }}
        >
          <Icon aria-hidden="true" className="h-6 w-6" />
        </Link>
      ))}
    </nav>
  )
}
