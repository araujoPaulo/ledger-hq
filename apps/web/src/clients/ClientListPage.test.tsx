import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ApiError } from '../api/client'

const listClients = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ listClients }))

const { ClientListPage } = await import('./ClientListPage')

await initI18n()
// jsdom reports navigator.language as "en-US", which initI18n reads to pick
// the initial locale, overriding the pt-PT fallback the Portuguese-only
// assertions below rely on (an established pattern from LoginPage.test.tsx).
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

const person = { ...company, id: '2', kind: 'INDIVIDUAL', name: 'Maria Santos', taxId: '123456789', legalForm: null }

// The brief's own render helper mounts `<ClientListPage />` bare, but the
// page renders `<Link>` from '@tanstack/react-router', which throws
// (`Cannot read properties of null (reading 'isServer')`) without a
// `<RouterProvider>` ancestor — proven empirically before writing this.
// Wrapping the page as a minimal router's root route supplies that context
// without pulling in the real app router (which would drag in
// RequireSession's live session/bootstrap queries). `Link`/`useNavigate`
// targets such as `/clients/new` need not be registered on this local
// router to render or navigate without throwing — confirmed empirically —
// so this stays a self-contained fixture.
function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute({ component: ClientListPage })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/clients'] }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('ClientListPage', () => {
  it('lists clients with their kind', async () => {
    listClients.mockResolvedValue([company, person])
    renderPage()

    expect(await screen.findByText('Padaria Central, Lda.')).toBeInTheDocument()
    expect(screen.getByText('Maria Santos')).toBeInTheDocument()
    // Scoped to the list: the kind filter <select> renders the same
    // translated labels as its own <option> text, so an unscoped
    // getAllByText also matches those two options (4 matches, not 2).
    const list = screen.getByRole('list')
    expect(within(list).getAllByText(/Empresa|Pessoa singular/)).toHaveLength(2)
  })

  it('shows an empty state', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    expect(await screen.findByText(/ainda não há clientes/i)).toBeInTheDocument()
  })

  // A fetch failure must not be indistinguishable from "no clients yet":
  // `data` stays `undefined`, so a plain `data?.length === 0` check falls
  // through to the empty state (or an empty `.map()`) with no indication
  // anything went wrong. Same class of bug already fixed in
  // FiscalProfileForm/ClientDetailPage and AddEmploymentForm.
  it('shows an error message rather than the empty state when the fetch fails', async () => {
    listClients.mockRejectedValue(new ApiError('common.internal_error', {}, 500))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(/erro no servidor|server error/i)
    expect(screen.queryByText(/ainda não há clientes/i)).not.toBeInTheDocument()
  })

  it('passes the search term to the query', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    await userEvent.type(await screen.findByRole('searchbox'), 'padaria')

    await vi.waitFor(() => {
      expect(listClients).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'padaria' }))
    })
  })

  it('filters by kind', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    await userEvent.selectOptions(await screen.findByLabelText(/tipo|kind/i), 'COMPANY')

    await vi.waitFor(() => {
      expect(listClients).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'COMPANY' }))
    })
  })
})
