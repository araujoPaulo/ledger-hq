import { Link, Outlet } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ConnectionStatus } from './ConnectionStatus'
import { LanguageSwitcher } from './LanguageSwitcher'
import { RequireSession } from '../router'
import { signOut } from '../auth/credentials'
import { SESSION_QUERY_KEY } from '../auth/session'
import { lockVault, useVaultState } from '../vault/vault-session'
import { useVaultSync } from '../vault/useVaultSync'

export function AppLayout() {
  const { t } = useTranslation('common')
  const queryClient = useQueryClient()
  const vaultState = useVaultState()
  useVaultSync()

  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    },
  })

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
          <Link to="/vault/platforms" className="text-sm">
            {t('nav.platforms')}
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <LanguageSwitcher />
            {vaultState.status === 'unlocked' && (
              <button
                type="button"
                onClick={() => lockVault()}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {t('actions.lockVault')}
              </button>
            )}
            <button
              type="button"
              onClick={() => signOutMutation.mutate()}
              disabled={signOutMutation.isPending}
              className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
            >
              {t('actions.signOut')}
            </button>
          </div>
        </nav>
      </header>
      <ConnectionStatus />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <RequireSession>
          <Outlet />
        </RequireSession>
      </main>
    </div>
  )
}
