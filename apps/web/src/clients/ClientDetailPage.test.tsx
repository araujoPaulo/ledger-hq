import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import { ApiError } from '../api/client'
import { validateClientSearch } from './clientTabs'

const getClient = vi.hoisted(() => vi.fn())
const archiveClient = vi.hoisted(() => vi.fn())
const getFiscalProfile = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({
  getClient,
  archiveClient,
  restoreClient: vi.fn(),
  getFiscalProfile,
  putFiscalProfile: vi.fn(),
}))
const listObligations = vi.hoisted(() => vi.fn())
vi.mock('../obligations/api', () => ({
  listObligations,
  generateObligations: vi.fn().mockResolvedValue({ toCreate: [], toRetract: [] }),
  patchObligation: vi.fn(),
  createAdHocObligation: vi.fn(),
}))
vi.mock('../billing/api', () => ({
  getClientLedger: vi.fn().mockResolvedValue({ entries: [], balanceCents: 0, availableCreditCents: 0 }),
  getCurrentRetainerPlan: vi.fn().mockResolvedValue(null),
  getReceivables: vi.fn().mockResolvedValue([]),
  proposeAllocation: vi.fn(),
  recordPayment: vi.fn(),
  applyCredit: vi.fn(),
  writeOffCharge: vi.fn(),
  createAdHocCharge: vi.fn(),
  createRetainerPlan: vi.fn(),
  renewRetainerPlan: vi.fn(),
}))

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

// `useParams`/`useSearch` need the real parameterised route, validating its
// search exactly as the app's router does.
function renderPage(url = '/clients/1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/clients/$clientId',
    validateSearch: validateClientSearch,
    component: ClientDetailPage,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([detailRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  })

  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return { router }
}

beforeEach(() => {
  getClient.mockReset().mockResolvedValue(company)
  archiveClient.mockReset()
  getFiscalProfile.mockReset().mockRejectedValue(new ApiError('common.not_found', {}, 404))
  listObligations.mockReset().mockResolvedValue([])
})

describe('ClientDetailPage', () => {
  it('shows a skeleton while the client loads', async () => {
    getClient.mockReturnValue(new Promise(() => {}))
    renderPage()

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull())
  })

  it('opens on Overview', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Padaria Central, Lda.' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Resumo' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('heading', { name: 'Dados' })).toBeInTheDocument()
  })

  it('opens the tab the URL names', async () => {
    renderPage('/clients/1?tab=billing')

    expect(await screen.findByRole('tab', { name: 'Faturação' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('region', { name: /^faturação$/i })).toBeInTheDocument()
  })

  // Review Focus 2.
  it('falls back to Overview for an unknown tab', async () => {
    renderPage('/clients/1?tab=faturas')

    expect(await screen.findByRole('tab', { name: 'Resumo' })).toHaveAttribute('aria-selected', 'true')
  })

  it('puts the chosen tab in the URL without adding history, and clears it for Overview', async () => {
    const { router } = renderPage()
    const before = router.history.length

    await userEvent.click(await screen.findByRole('tab', { name: 'Faturação' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'billing' }))
    expect(router.history.length).toBe(before)

    await userEvent.click(screen.getByRole('tab', { name: 'Resumo' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
  })

  it('names the People tab for the client kind', async () => {
    renderPage()

    expect(await screen.findByRole('tab', { name: 'Empregados' })).toBeInTheDocument()
  })

  it('counts overdue obligations on the Obligations tab once Overview has loaded them', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    listObligations.mockResolvedValue([
      {
        id: 'o1',
        clientId: '1',
        clientName: company.name,
        definitionCode: 'VAT_MONTHLY_RETURN',
        definitionName: 'Declaração periódica de IVA',
        authority: 'TAX',
        periodLabel: '2026-01',
        dueDate: yesterday,
        dueDateOverridden: false,
        status: 'PENDING',
        completedAt: null,
        reference: null,
        amountCents: null,
        notes: null,
      },
    ])
    renderPage()

    expect(await screen.findByRole('tab', { name: /obrigações\s*1/i })).toBeInTheDocument()
  })

  it('links to the edit page', async () => {
    renderPage()

    expect(await screen.findByRole('link', { name: /^editar$/i })).toHaveAttribute('href', '/clients/1/edit')
    expect(screen.getByRole('button', { name: /^arquivar$/i })).toBeInTheDocument()
  })

  // The server refuses to edit an archived client; the button is not offered.
  it('offers no Edit for an archived client, only Restore, and marks it archived', async () => {
    getClient.mockResolvedValue({ ...company, archivedAt: '2026-09-01T10:00:00.000Z' })
    renderPage()

    expect(await screen.findByRole('button', { name: /^restaurar$/i })).toBeInTheDocument()
    expect(screen.getByText('Arquivado')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^editar$/i })).not.toBeInTheDocument()
  })

  it('archives from the header', async () => {
    archiveClient.mockResolvedValue({ ...company, archivedAt: '2026-09-01T10:00:00.000Z' })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /^arquivar$/i }))

    await waitFor(() => expect(archiveClient).toHaveBeenCalledWith('1'))
  })

  // Below md the actions move into a menu (the CSS switch itself is the e2e's).
  it('offers Edit and Archive in the mobile actions menu', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Ações do cliente' }))

    expect(await screen.findByRole('menuitem', { name: /^editar$/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^arquivar$/i })).toBeInTheDocument()
  })
})
