import { render, screen } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import { initI18n } from '../i18n'
import { MobileTabBar } from './MobileNav'

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderTabBar() {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: MobileTabBar })
  const clientsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/clients',
    component: () => null,
  })
  const vaultRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/vault/platforms',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, clientsRoute, vaultRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <I18nextProvider i18n={i18next}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  )
}

describe('MobileTabBar', () => {
  it('labels every icon-only tab', async () => {
    renderTabBar()

    expect(await screen.findByRole('link', { name: /prazos/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /clientes/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /cofre/i })).toBeInTheDocument()
  })

  // index.html sets viewport-fit=cover, so a fixed bottom bar sits under the
  // iOS home indicator unless it pads for the safe area. jsdom has no layout
  // and Chromium reports no inset, so the declaration is the only thing that
  // can be asserted — and it is the whole behaviour.
  it('pads for the iOS home indicator', async () => {
    renderTabBar()

    const bar = (await screen.findByRole('link', { name: /prazos/i })).closest('nav')
    expect(bar?.className).toContain('safe-area-inset-bottom')
  })
})
