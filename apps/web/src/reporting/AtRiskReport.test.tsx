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
import { formatCurrency } from '../i18n/format'

const getAtRiskMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getAtRisk: getAtRiskMock, getPeriodSummary: vi.fn() }))

const { AtRiskReport } = await import('./AtRiskReport')

await initI18n()
await i18next.changeLanguage('pt-PT')

// `formatCurrency` separates thousands with a narrow no-break space (U+202F).
function shown(value: string): string {
  return value.replace(/\s/g, ' ')
}

function renderReport() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: AtRiskReport })
  const clientRoute = createRoute({ getParentRoute: () => rootRoute, path: '/clients/$clientId', component: () => null })
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

beforeEach(() => {
  getAtRiskMock.mockReset()
})

describe('AtRiskReport', () => {
  it('lists a client with both counts and links to it', async () => {
    getAtRiskMock.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Padaria Central, Lda.',
        overdueObligations: 3,
        oldestDueDate: '2026-03-15',
        grossOutstandingCents: 20000,
        creditCents: 0,
        outstandingCents: 20000,
        oldestChargeDueOn: '2026-05-31',
      },
    ])

    renderReport()

    expect(await screen.findByRole('link', { name: /padaria central/i })).toHaveAttribute('href', '/clients/c1')
    expect(screen.getByText('3')).toBeVisible()
    expect(screen.getByText(shown(formatCurrency(20000, 'pt-PT')))).toBeVisible()
  })

  // Finding 4 of the whole-branch review: `oldestChargeDueOn` is credit-aware
  // (names the oldest charge the credit still fails to reach) but was never
  // rendered, so a fix nobody could see by eye was also a fix nobody could
  // verify by eye.
  it('shows the oldest unpaid charge', async () => {
    getAtRiskMock.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Padaria Central, Lda.',
        overdueObligations: 1,
        oldestDueDate: '2026-03-15',
        grossOutstandingCents: 20000,
        creditCents: 0,
        outstandingCents: 20000,
        oldestChargeDueOn: '2026-05-31',
      },
    ])

    renderReport()

    expect(await screen.findByText(/31\/05\/2026/)).toBeVisible()
  })

  it('shows credit beside the net figure when there is any', async () => {
    getAtRiskMock.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Padaria Central, Lda.',
        overdueObligations: 1,
        oldestDueDate: '2026-03-15',
        grossOutstandingCents: 20000,
        creditCents: 15000,
        outstandingCents: 5000,
        oldestChargeDueOn: '2026-05-31',
      },
    ])

    renderReport()

    expect(await screen.findByText(shown(formatCurrency(5000, 'pt-PT')))).toBeVisible()
    expect(screen.getByText(shown(formatCurrency(15000, 'pt-PT')))).toBeVisible()
  })

  it('shows an empty state when nobody is at risk', async () => {
    getAtRiskMock.mockResolvedValue([])

    renderReport()

    expect(await screen.findByText(/nenhum cliente em risco/i)).toBeVisible()
  })

  it('offers the download only when there is something to download', async () => {
    getAtRiskMock.mockResolvedValue([])

    renderReport()

    await screen.findByText(/nenhum cliente em risco/i)
    expect(screen.queryByRole('button', { name: /descarregar csv/i })).toBeNull()
  })

  it('shows a skeleton while the report is pending', async () => {
    getAtRiskMock.mockReturnValue(new Promise(() => {}))

    const { container } = renderReport()

    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull())
  })

  it('shows an error, not the empty state, when the report fails', async () => {
    getAtRiskMock.mockRejectedValue(new Error('boom'))

    renderReport()

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.queryByText(/nenhum cliente em risco/i)).not.toBeInTheDocument()
  })
})
