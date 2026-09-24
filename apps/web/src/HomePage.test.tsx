import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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
import { initI18n } from './i18n'

const listObligationsMock = vi.hoisted(() => vi.fn())
const patchObligationMock = vi.hoisted(() => vi.fn())
vi.mock('./obligations/api', () => ({
  listObligations: listObligationsMock,
  patchObligation: patchObligationMock,
}))

const getReceivablesMock = vi.hoisted(() => vi.fn())
vi.mock('./billing/api', () => ({ getReceivables: getReceivablesMock }))

const { HomePage } = await import('./HomePage')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage })
  const clientRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/clients/$clientId',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, clientRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    listObligationsMock.mockReset()
    getReceivablesMock.mockReset()
  })

  it('owns the page heading', async () => {
    listObligationsMock.mockResolvedValue([])
    getReceivablesMock.mockResolvedValue([])
    renderHome()

    expect(await screen.findByRole('heading', { level: 1, name: /resumo/i })).toBeInTheDocument()
  })

  // The whole reason the two sections keep separate queries: a slow
  // receivables response must not hold the obligations list back.
  it('renders the obligations list while receivables is still pending', async () => {
    listObligationsMock.mockResolvedValue([
      {
        id: 'o1',
        clientId: 'c1',
        clientName: 'Padaria Central',
        definitionCode: 'VAT_MONTHLY_RETURN',
        definitionName: 'Pagamento de IVA',
        authority: 'TAX',
        periodLabel: '2026-09',
        dueDate: '2026-09-20',
        dueDateOverridden: false,
        status: 'PENDING',
        completedAt: null,
      },
    ])
    getReceivablesMock.mockReturnValue(new Promise(() => {}))
    renderHome()

    expect(await screen.findByText(/pagamento de iva/i)).toBeInTheDocument()
  })

  // Review Focus 1. "0 overdue" when nothing could load is worse than
  // saying nothing: it is a wrong answer stated confidently.
  it('renders no summary tiles when both queries fail', async () => {
    listObligationsMock.mockRejectedValue(new Error('offline'))
    getReceivablesMock.mockRejectedValue(new Error('offline'))
    renderHome()

    expect(await screen.findByRole('heading', { level: 1, name: /resumo/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText(/em dívida/i)).not.toBeInTheDocument()
    })
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})
