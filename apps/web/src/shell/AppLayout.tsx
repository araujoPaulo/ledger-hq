import { Link, Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export function AppLayout() {
  const { t } = useTranslation('common')

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <Link to="/" className="font-semibold">
            {t('appName')}
          </Link>
          <Link to="/clients" className="text-sm">
            {t('nav.clients')}
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
