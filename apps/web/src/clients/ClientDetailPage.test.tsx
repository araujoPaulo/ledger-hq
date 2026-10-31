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
vi.mock('./api', () => ({ getClient, getFiscalProfile, putFiscalProfile: vi.fn(), archiveClient, restoreClient }))

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
  it('links to the edit page', async () => {
    getClient.mockResolvedValue(company)
    getFiscalProfile.mockRejectedValue(new ApiError('common.not_found', {}, 404))
    renderPage('1')

    expect(await screen.findByRole('link', { name: /^editar$/i })).toHaveAttribute('href', '/clients/1/edit')
    expect(screen.getByRole('button', { name: /^arquivar$/i })).toBeInTheDocument()
  })

  // The server refuses to edit an archived client; the button is not offered.
  it('offers no Edit for an archived client, only Restore', async () => {
    getClient.mockResolvedValue({ ...company, archivedAt: '2026-09-01T10:00:00.000Z' })
    getFiscalProfile.mockRejectedValue(new ApiError('common.not_found', {}, 404))
    renderPage('1')

    expect(await screen.findByRole('button', { name: /^restaurar$/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^editar$/i })).not.toBeInTheDocument()
  })
})
