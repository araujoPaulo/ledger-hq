import type { ReactNode } from 'react'
import { useBootstrapRequired, useSession } from './session'
import { AuthLayout } from './AuthLayout'
import { AuthSplash } from './AuthSplash'
import { LoginPage } from './LoginPage'
import { SetupPage } from './SetupPage'

/**
 * Wraps the whole shell, not just its content: without a session there is no
 * sidebar, tab bar, search box or account menu — none of them can do anything
 * for someone who is not signed in.
 *
 * The order is the one this gate has always had: a fresh install sets up the
 * account before anything else; otherwise no session means sign-in.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const bootstrap = useBootstrapRequired()
  const session = useSession()

  if (bootstrap.isPending || session.isPending) return <AuthSplash />

  if (bootstrap.data?.required === true) {
    return (
      <AuthLayout>
        <SetupPage />
      </AuthLayout>
    )
  }

  if (session.isError) {
    return (
      <AuthLayout>
        <LoginPage />
      </AuthLayout>
    )
  }

  return <>{children}</>
}
