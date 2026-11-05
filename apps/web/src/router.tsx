import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppLayout } from './shell/AppLayout'
import { RequireSession } from './auth/RequireSession'
import { ClientListPage } from './clients/ClientListPage'
import { ClientFormPage } from './clients/ClientFormPage'
import { ClientDetailPage } from './clients/ClientDetailPage'
import { ClientEditPage } from './clients/ClientEditPage'
import { VaultSetupPage } from './vault/VaultSetupPage'
import { PlatformsPage } from './vault/PlatformsPage'
import { HomePage } from './HomePage'
import { validateClientSearch } from './clients/clientTabs'
import { SearchResultsPage } from './search/SearchResultsPage'
import { ReportingPage } from './reporting/ReportingPage'

function Root() {
  return (
    <RequireSession>
      <AppLayout />
    </RequireSession>
  )
}

const rootRoute = createRootRoute({ component: Root })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
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
  // The active tab lives in the URL, so a reload keeps it and a receivable
  // can link straight to its client's Billing tab.
  validateSearch: validateClientSearch,
  component: ClientDetailPage,
})

const clientEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients/$clientId/edit',
  component: ClientEditPage,
})

const vaultSetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/vault/setup',
  component: VaultSetupPage,
})

const platformsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/vault/platforms',
  component: PlatformsPage,
})

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  // The query lives in the URL so a result list is linkable and survives a
  // reload. A missing or non-string `q` reads as empty rather than throwing.
  validateSearch: (search: Record<string, unknown>) => ({ q: typeof search.q === 'string' ? search.q : '' }),
  component: SearchResultsPage,
})

const reportingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reporting',
  component: ReportingPage,
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    clientsRoute,
    clientNewRoute,
    clientDetailRoute,
    clientEditRoute,
    vaultSetupRoute,
    platformsRoute,
    searchRoute,
    reportingRoute,
  ]),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
