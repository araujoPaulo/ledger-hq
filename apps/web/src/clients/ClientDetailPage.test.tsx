import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
import { describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ApiError } from '../api/client'

const getClient = vi.hoisted(() => vi.fn())
const getFiscalProfile = vi.hoisted(() => vi.fn())
const archiveClient = vi.hoisted(() => vi.fn())
const restoreClient = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getClient, getFiscalProfile, archiveClient, restoreClient }))

const { ClientDetailPage } = await import('./ClientDetailPage')

await initI18n()
// Same pin as the rest of clients/*.test.tsx: jsdom reports
// navigator.language as "en-US", overriding the pt-PT fallback these
// Portuguese-only assertions rely on.
await i18next.changeLanguage('pt-PT')

const company = {
  id: '1',
  kind: 'COMPANY',
  name: 'Padaria Central, Lda.',
  taxId: '501442600',
  accounting: 'ORGANIZED',
  legalForm: 'LDA',
  email: null,
  phone: null,
  notes: null,
  socialSecurityNo: null,
  dateOfBirth: null,
  archivedAt: null,
}

// Same fix as ClientListPage.test.tsx/ClientFormPage.test.tsx: `useParams`
// needs a real matched route (not just a RouterProvider ancestor), so this
// builds a router whose one route is the actual parameterised path, with
// memory history opened directly on the client's URL.
function renderPage(clientId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/clients/$clientId',
    component: ClientDetailPage,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([detailRoute]),
    history: createMemoryHistory({ initialEntries: [`/clients/${clientId}`] }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('ClientDetailPage', () => {
  it('shows an error message, not the fiscal profile form, when the fetch genuinely fails', async () => {
    getClient.mockResolvedValue(company)
    getFiscalProfile.mockRejectedValue(new ApiError('common.internal_error', {}, 500))
    renderPage('1')

    expect(await screen.findByText(/ocorreu um erro no servidor/i)).toBeInTheDocument()
    expect(screen.queryByText(/perfil fiscal/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /guardar/i })).not.toBeInTheDocument()
  })

  it('renders the fiscal profile form with defaults when no profile exists yet', async () => {
    getClient.mockResolvedValue(company)
    getFiscalProfile.mockRejectedValue(new ApiError('common.not_found', {}, 404))
    renderPage('1')

    expect(await screen.findByText(/perfil fiscal/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /guardar/i })).toBeInTheDocument()
    expect(screen.queryByText(/ocorreu um erro no servidor/i)).not.toBeInTheDocument()
  })
})
