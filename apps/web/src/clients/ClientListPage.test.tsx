import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
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
  it('lists clients with their tax number and a kind badge', async () => {
    listClients.mockResolvedValue([company, person])
    renderPage()

    expect(await screen.findByRole('link', { name: 'Padaria Central, Lda.' })).toHaveAttribute('href', '/clients/1')
    expect(screen.getByRole('link', { name: 'Maria Santos' })).toHaveAttribute('href', '/clients/2')
    // Spans only: the kind filter's <option>s carry the same two words.
    expect(screen.getAllByText(/^(Empresa|Pessoa singular)$/, { selector: 'span' })).toHaveLength(2)
    // Twice per row: the mobile caption and the desktop column (CSS picks one).
    expect(screen.getAllByText('501442600')).toHaveLength(2)
  })

  it('counts the results with the right plural', async () => {
    listClients.mockResolvedValue([company, person])
    const { unmount } = renderPage()
    expect(await screen.findByText('2 clientes')).toBeInTheDocument()
    unmount()

    listClients.mockResolvedValue([company])
    renderPage()
    expect(await screen.findByText('1 cliente')).toBeInTheDocument()
  })

  it('shows a skeleton and the real filter bar while the first load is pending, and no count', async () => {
    listClients.mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()

    expect(await screen.findByRole('searchbox', { name: /pesquisar por nome ou nif/i })).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByText(/^\d+ clientes?$/)).not.toBeInTheDocument()
  })

  it('offers to create the first client when there are none', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    expect(await screen.findByText('Ainda não há clientes')).toBeInTheDocument()
    expect(screen.getByText(/cria o primeiro cliente/i)).toBeInTheDocument()
    // The header's Create and the empty state's own.
    expect(screen.getAllByRole('link', { name: /criar/i })).toHaveLength(2)
  })

  it('says the filters match nothing, without a Create action, when a search finds nothing', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    await userEvent.type(await screen.findByRole('searchbox'), 'zzz')

    expect(await screen.findByText('Nenhum cliente corresponde aos filtros.')).toBeInTheDocument()
    expect(screen.queryByText('Ainda não há clientes')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /criar/i })).toHaveLength(1)
  })

  it('treats a kind filter that matches nothing as filtered', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    await userEvent.selectOptions(await screen.findByLabelText(/^tipo$/i), 'COMPANY')

    expect(await screen.findByText('Nenhum cliente corresponde aos filtros.')).toBeInTheDocument()
  })

  // Review Focus 2: the server trims the search to nothing, so it is no filter.
  it('treats a search of only spaces as no search at all', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    await userEvent.type(await screen.findByRole('searchbox'), '   ')
    await vi.waitFor(() => {
      expect(listClients).toHaveBeenLastCalledWith(expect.objectContaining({ search: '   ' }))
    })

    expect(await screen.findByText('Ainda não há clientes')).toBeInTheDocument()
    expect(screen.queryByText('Nenhum cliente corresponde aos filtros.')).not.toBeInTheDocument()
  })

  // Spec §6.1: with "Show archived" on and nothing back, there are no clients at all.
  it('does not count "Show archived" alone as a filter', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    await userEvent.click(await screen.findByRole('checkbox', { name: /mostrar arquivados/i }))
    await vi.waitFor(() => {
      expect(listClients).toHaveBeenLastCalledWith(expect.objectContaining({ includeArchived: true }))
    })

    expect(await screen.findByText('Ainda não há clientes')).toBeInTheDocument()
  })

  it('marks an archived client with a badge', async () => {
    listClients.mockResolvedValue([{ ...company, archivedAt: '2026-09-01T10:00:00.000Z' }])
    renderPage()

    expect(await screen.findByText('Arquivado')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Padaria Central, Lda.' })).toHaveClass('text-muted')
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
