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
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ApiError } from '../api/client'
import { validateClientSearch } from './clientTabs'

const getFiscalProfile = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getFiscalProfile, putFiscalProfile: vi.fn() }))
const listObligations = vi.hoisted(() => vi.fn())
vi.mock('../obligations/api', () => ({ listObligations }))
const getClientLedger = vi.hoisted(() => vi.fn())
vi.mock('../billing/api', () => ({ getClientLedger }))

const { ClientOverviewTab } = await import('./ClientOverviewTab')

await initI18n()
await i18next.changeLanguage('pt-PT')

const client = {
  id: '1',
  kind: 'COMPANY' as const,
  name: 'Padaria Central, Lda.',
  taxId: '501442600',
  accounting: 'ORGANIZED' as const,
  legalForm: 'LDA',
  email: 'geral@padaria.pt',
  phone: '912 345 678',
  notes: 'Fecha às segundas.',
  socialSecurityNo: null,
  dateOfBirth: null,
  archivedAt: null,
}

function isoDaysFromToday(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function obligation(id: string, dueDate: string) {
  return {
    id,
    clientId: '1',
    clientName: client.name,
    definitionCode: 'VAT_MONTHLY_RETURN',
    definitionName: 'Declaração periódica de IVA',
    authority: 'TAX',
    periodLabel: '2026-01',
    dueDate,
    dueDateOverridden: false,
    status: 'PENDING',
    completedAt: null,
    reference: null,
    amountCents: null,
    notes: null,
  }
}

// The tiles are Links to the client route with a tab, so the tab renders
// under a router whose detail route validates its search like the app's.
function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/clients/$clientId',
    validateSearch: validateClientSearch,
    component: () => <ClientOverviewTab client={client} />,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/clients/1'] }),
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
  getFiscalProfile.mockReset().mockRejectedValue(new ApiError('common.not_found', {}, 404))
  listObligations.mockReset().mockResolvedValue([])
  getClientLedger.mockReset().mockResolvedValue({ entries: [], balanceCents: 0, availableCreditCents: 0 })
})

describe('ClientOverviewTab', () => {
  it('lists the details that are set, with email and phone as links', async () => {
    renderTab()

    expect(await screen.findByRole('heading', { name: 'Dados' })).toBeInTheDocument()
    expect(screen.getByText('501442600')).toBeInTheDocument()
    expect(screen.getByText('Sociedade por quotas')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'geral@padaria.pt' })).toHaveAttribute('href', 'mailto:geral@padaria.pt')
    expect(screen.getByRole('link', { name: '912 345 678' })).toHaveAttribute('href', 'tel:912345678')
    expect(screen.queryByText('NISS')).not.toBeInTheDocument()
  })

  it('shows notes as prose under the details, not as a row', async () => {
    renderTab()

    const notes = await screen.findByText('Fecha às segundas.')
    expect(notes.tagName).toBe('P')
  })

  it('counts overdue and this-week obligations, in danger red when any are overdue', async () => {
    listObligations.mockResolvedValue([
      obligation('o1', isoDaysFromToday(-3)),
      obligation('o2', isoDaysFromToday(2)),
      obligation('o3', isoDaysFromToday(60)),
    ])
    renderTab()

    const tile = await screen.findByRole('link', { name: /obrigações a vencer\s*2/i })
    expect(tile).toHaveAttribute('href', '/clients/1?tab=obligations')
    expect(screen.getByText('2')).toHaveClass('text-danger-700')
  })

  it('shows the balance, linked to the Billing tab', async () => {
    getClientLedger.mockResolvedValue({ entries: [], balanceCents: 15000, availableCreditCents: 0 })
    renderTab()

    const tile = await screen.findByRole('link', { name: /saldo\s*150,00/i })
    expect(tile).toHaveAttribute('href', '/clients/1?tab=billing')
  })

  it('renders the fiscal profile card', async () => {
    renderTab()

    expect(await screen.findByRole('heading', { name: 'Perfil fiscal' })).toBeInTheDocument()
  })
})
