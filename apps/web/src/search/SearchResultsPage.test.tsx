import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const getSearchResultsMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getSearchResults: getSearchResultsMock }))

const { SearchResultsPage } = await import('./SearchResultsPage')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderPage(initialUrl: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const searchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/search',
    validateSearch: (search: Record<string, unknown>) => ({ q: typeof search.q === 'string' ? search.q : '' }),
    component: SearchResultsPage,
  })
  const clientRoute = createRoute({ getParentRoute: () => rootRoute, path: '/clients/$clientId', component: () => null })
  const platformsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/vault/platforms', component: () => null })
  const router = createRouter({
    routeTree: rootRoute.addChildren([searchRoute, clientRoute, platformsRoute]),
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getSearchResultsMock.mockReset()
})

describe('SearchResultsPage', () => {
  it('groups hits under a heading per type', async () => {
    getSearchResultsMock.mockResolvedValue([
      { type: 'client', id: 'c1', label: 'Marisa Unipessoal, Lda.', context: null, href: '/clients/c1', rank: 0.9 },
      { type: 'charge', id: 'ch1', label: 'Trabalho extra', context: 'Marisa Unipessoal, Lda.', href: '/clients/c1', rank: 0.2 },
    ])

    renderPage('/search?q=mari')

    expect(await screen.findByRole('heading', { name: /^clientes$/i })).toBeVisible()
    expect(screen.getByRole('heading', { name: /^cobranças$/i })).toBeVisible()
    expect(screen.getByRole('link', { name: /marisa unipessoal/i })).toHaveAttribute('href', '/clients/c1')
  })

  it('shows the owning client as context on a hit that has one', async () => {
    getSearchResultsMock.mockResolvedValue([
      { type: 'obligation', id: 'o1', label: 'IVA trimestral · 2026-Q1', context: 'Padaria Central, Lda.', href: '/clients/c1', rank: 0.5 },
    ])

    renderPage('/search?q=iva')

    expect(await screen.findByText('Padaria Central, Lda.')).toBeVisible()
  })

  it('shows an empty state when the search found nothing', async () => {
    getSearchResultsMock.mockResolvedValue([])

    renderPage('/search?q=zzzz')

    expect(await screen.findByText(/nada encontrado/i)).toBeVisible()
  })

  it('prompts rather than searching when the query is empty', async () => {
    renderPage('/search?q=')

    expect(await screen.findByText(/escreve para pesquisar/i)).toBeVisible()
    await waitFor(() => expect(getSearchResultsMock).not.toHaveBeenCalled())
  })

  it('shows a skeleton while the search is pending', async () => {
    getSearchResultsMock.mockReturnValue(new Promise(() => {}))

    const { container } = renderPage('/search?q=mari')

    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull())
  })

  it('shows an error, not the empty state, when the search fails', async () => {
    getSearchResultsMock.mockRejectedValue(new Error('boom'))

    renderPage('/search?q=mari')

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.queryByText(/nada encontrado/i)).not.toBeInTheDocument()
  })
})
