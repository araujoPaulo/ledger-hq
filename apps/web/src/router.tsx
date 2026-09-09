import type { ReactNode } from 'react'
import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppLayout } from './shell/AppLayout'
import { useBootstrapRequired, useSession } from './auth/session'
import { LoginPage } from './auth/LoginPage'
import { SetupPage } from './auth/SetupPage'

export function RequireSession({ children }: { children: ReactNode }) {
  const bootstrap = useBootstrapRequired()
  const session = useSession()

  if (bootstrap.isPending || session.isPending) return null
  if (bootstrap.data?.required === true) return <SetupPage />
  if (session.isError) return <LoginPage />

  return <>{children}</>
}

const rootRoute = createRootRoute({ component: AppLayout })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => null,
})

// Registered so the shell's nav link in AppLayout type-checks against
// TanStack Router's typed `Link`. The client register itself is out of
// scope for this task; a later task replaces this stub with a real page.
const clientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients',
  component: () => null,
})

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, clientsRoute]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
