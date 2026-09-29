import { render, screen, waitFor, within } from '@testing-library/react'
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

const getReceivablesMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getReceivables: getReceivablesMock }))

const { ReceivablesSection } = await import('./ReceivablesSection')

await initI18n()
await i18next.changeLanguage('pt-PT')

// `formatCurrency` separates thousands with a narrow no-break space (U+202F).
// Testing Library normalizes whitespace in the DOM before matching but leaves
// the query string alone, so the expected text needs the same treatment.
function shown(value: string): string {
  return value.replace(/\s/g, ' ')
}

// The client name is a router Link now, so the section can only render inside
// a router: a bare render throws.
function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: ReceivablesSection,
  })
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

describe('ReceivablesSection', () => {
  beforeEach(() => {
    getReceivablesMock.mockReset()
  })

  it('shows the empty state when nothing is outstanding', async () => {
    getReceivablesMock.mockResolvedValue([])
    renderSection()
    expect(await screen.findByText(/sem valores em atraso/i)).toBeInTheDocument()
  })

  it('lists a client with an outstanding balance and its ageing bucket', async () => {
    getReceivablesMock.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Padaria Central',
        grossOutstandingCents: 27000,
        creditCents: 0,
        outstandingCents: 27000,
        oldestDueOn: '2026-01-08',
        ageingBucket: '61-90',
      },
    ])
    renderSection()
    expect(await screen.findByText(/padaria central/i)).toBeInTheDocument()
    expect(screen.getByText(/61-90/)).toBeInTheDocument()
  })

  it('links each client name to its detail page', async () => {
    getReceivablesMock.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Padaria Central',
        grossOutstandingCents: 27_000,
        creditCents: 0,
        outstandingCents: 27_000,
        oldestDueOn: '2026-01-08',
        ageingBucket: '61-90',
      },
    ])
    renderSection()

    const link = await screen.findByRole('link', { name: /padaria central/i })
    expect(link).toHaveAttribute('href', '/clients/c1')
  })

  it('shows the total of every outstanding balance', async () => {
    getReceivablesMock.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Padaria Central',
        grossOutstandingCents: 27_000,
        creditCents: 0,
        outstandingCents: 27_000,
        oldestDueOn: '2026-01-08',
        ageingBucket: '61-90',
      },
      {
        clientId: 'c2',
        clientName: 'Clínica Aurora',
        grossOutstandingCents: 13_000,
        creditCents: 0,
        outstandingCents: 13_000,
        oldestDueOn: '2026-03-02',
        ageingBucket: '0-30',
      },
    ])
    renderSection()

    expect(await screen.findByText(shown(formatCurrency(40_000, 'pt-PT')))).toBeInTheDocument()
  })

  // Review Focus 4. A long name must truncate, not shove the amount out of
  // the row: the amount has to stay on screen for the row to be worth having.
  it('truncates a long client name instead of pushing the amount out', async () => {
    getReceivablesMock.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Sociedade de Construções e Empreitadas do Vale do Sousa, Unipessoal Lda',
        grossOutstandingCents: 27_000,
        creditCents: 0,
        outstandingCents: 27_000,
        oldestDueOn: '2026-01-08',
        ageingBucket: '61-90',
      },
    ])
    renderSection()

    const link = await screen.findByRole('link', { name: /sociedade de construções/i })
    expect(link.closest('span')?.className).toContain('truncate')

    // Scoped to the row: with a single receivable the total below carries the
    // same figure, so an unscoped query matches twice.
    const row = link.closest('div')
    expect(row).not.toBeNull()
    expect(within(row!).getByText(shown(formatCurrency(27_000, 'pt-PT')))).toBeInTheDocument()
  })

  it('shows a skeleton while loading', async () => {
    getReceivablesMock.mockReturnValue(new Promise(() => {}))
    const { container } = renderSection()

    await waitFor(() => {
      expect(container.querySelectorAll('[aria-hidden="true"].animate-pulse').length).toBeGreaterThan(0)
    })
  })
})

describe('client credit', () => {
  it('shows gross and credit beside the net figure when credit is involved', async () => {
    getReceivablesMock.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Padaria Central',
        grossOutstandingCents: 20000,
        creditCents: 15000,
        outstandingCents: 5000,
        oldestDueOn: '2026-05-31',
        ageingBucket: '0-30',
      },
    ])

    renderSection()

    const link = await screen.findByRole('link', { name: /padaria central/i })
    expect(link).toBeVisible()
    const row = link.closest('div')
    expect(row).not.toBeNull()
    // Scoped to the row: with a single receivable the total below carries
    // the same net figure, so an unscoped query matches twice.
    expect(within(row!).getByText(shown(formatCurrency(5000, 'pt-PT')))).toBeVisible()
    expect(screen.getByText(shown(formatCurrency(20000, 'pt-PT')))).toBeVisible()
    expect(screen.getByText(shown(formatCurrency(15000, 'pt-PT')))).toBeVisible()
  })

  it('shows only the one figure when there is no credit', async () => {
    getReceivablesMock.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Padaria Central',
        grossOutstandingCents: 20000,
        creditCents: 0,
        outstandingCents: 20000,
        oldestDueOn: '2026-05-31',
        ageingBucket: '0-30',
      },
    ])

    renderSection()

    await screen.findByText('Padaria Central')
    // One amount in the row, plus the list total — never a redundant
    // "gross 200,00 EUR, credit 0,00 EUR" restating the same number twice.
    expect(screen.queryByText(/bruto/i)).toBeNull()
    expect(screen.queryByText(/crédito/i)).toBeNull()
  })

  it('totals the net figures', async () => {
    getReceivablesMock.mockResolvedValue([
      { clientId: 'c1', clientName: 'A', grossOutstandingCents: 20000, creditCents: 15000, outstandingCents: 5000, oldestDueOn: '2026-05-31', ageingBucket: '0-30' },
      { clientId: 'c2', clientName: 'B', grossOutstandingCents: 9000, creditCents: 0, outstandingCents: 9000, oldestDueOn: '2026-01-05', ageingBucket: '90+' },
    ])

    renderSection()

    expect(await screen.findByText(shown(formatCurrency(14000, 'pt-PT')))).toBeVisible()
  })
})
