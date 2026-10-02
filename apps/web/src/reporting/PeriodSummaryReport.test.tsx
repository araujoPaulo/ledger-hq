import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const getPeriodSummaryMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getAtRisk: vi.fn(), getPeriodSummary: getPeriodSummaryMock }))

const { PeriodSummaryReport } = await import('./PeriodSummaryReport')

await initI18n()
await i18next.changeLanguage('pt-PT')

// `formatCurrency` separates thousands with a narrow no-break space (U+202F).
function shown(value: string): string {
  return value.replace(/\s/g, ' ')
}

function renderReport() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: PeriodSummaryReport })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
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
  getPeriodSummaryMock.mockReset()
})

describe('PeriodSummaryReport', () => {
  it('shows the figures for the default window', async () => {
    getPeriodSummaryMock.mockResolvedValue({
      from: '2026-01-01',
      to: '2026-12-31',
      obligationsDue: 12,
      obligationsDone: 9,
      chargesIssuedCents: 500000,
      paymentsReceivedCents: 300000,
      outstandingAtCloseCents: 200000,
    })

    renderReport()

    expect(await screen.findByText('12')).toBeVisible()
    expect(screen.getByText('9')).toBeVisible()
    expect(screen.getByText(shown(formatCurrency(500000, 'pt-PT')))).toBeVisible()
    expect(screen.getByText(shown(formatCurrency(300000, 'pt-PT')))).toBeVisible()
    expect(screen.getByText(shown(formatCurrency(200000, 'pt-PT')))).toBeVisible()
    expect(getPeriodSummaryMock).toHaveBeenCalledWith('2026-01-01', '2026-12-31')
  })

  it('shows a skeleton while the report is pending', async () => {
    getPeriodSummaryMock.mockReturnValue(new Promise(() => {}))

    const { container } = renderReport()

    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull())
  })

  it('shows an error, not stale figures, when the report fails', async () => {
    getPeriodSummaryMock.mockRejectedValue(new Error('boom'))

    renderReport()

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.queryByText(/obrigações com prazo/i)).not.toBeInTheDocument()
  })

  it('offers the download only once the figures have loaded', async () => {
    getPeriodSummaryMock.mockReturnValue(new Promise(() => {}))

    renderReport()

    expect(screen.queryByRole('button', { name: /descarregar csv/i })).toBeNull()
  })

  it('never asks the server for an inverted range', async () => {
    getPeriodSummaryMock.mockResolvedValue({
      from: '2026-01-01',
      to: '2026-12-31',
      obligationsDue: 3,
      obligationsDone: 1,
      chargesIssuedCents: 100,
      paymentsReceivedCents: 100,
      outstandingAtCloseCents: 0,
    })

    const { container } = renderReport()
    await screen.findByText('3')

    getPeriodSummaryMock.mockClear()

    // "Até" (to) moved before "De" (from): the window is now inverted.
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2020-01-01' } })

    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull())
    expect(getPeriodSummaryMock).not.toHaveBeenCalled()
  })
})
