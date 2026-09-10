import type { ReactNode } from 'react'
import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppLayout } from './shell/AppLayout'
import { useBootstrapRequired, useSession } from './auth/session'
import { LoginPage } from './auth/LoginPage'
import { SetupPage } from './auth/SetupPage'
import { ClientListPage } from './clients/ClientListPage'
import { ClientFormPage } from './clients/ClientFormPage'
import { ClientDetailPage } from './clients/ClientDetailPage'

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

const clientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients',
  component: ClientListPage,
})

const clientNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients/new',
  component: ClientFormPage,
})

const clientDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients/$clientId',
  component: ClientDetailPage,
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, clientsRoute, clientNewRoute, clientDetailRoute]),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
