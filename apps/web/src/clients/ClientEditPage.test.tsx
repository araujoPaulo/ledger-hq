import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
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

const getClient = vi.hoisted(() => vi.fn())
const updateClient = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getClient, updateClient }))

const { ClientEditPage } = await import('./ClientEditPage')

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
  email: 'geral@padaria.pt',
  phone: null,
  notes: null,
  socialSecurityNo: null,
  dateOfBirth: null,
  archivedAt: null,
}

// `useParams({ from })` needs the real parameterised route matched, and the
// success path navigates to the detail route, so both are registered. The
// detail route's component only proves where navigation landed.
function renderPage(clientId = '1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/clients/$clientId',
    component: () => <p>detalhe do cliente</p>,
  })
  const editRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/clients/$clientId/edit',
    component: ClientEditPage,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([detailRoute, editRoute]),
    history: createMemoryHistory({ initialEntries: [`/clients/${clientId}/edit`] }),
  })

  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )

  return { ...result, router, queryClient }
}

describe('ClientEditPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows a form-shaped skeleton while the client loads', async () => {
    getClient.mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()

    await vi.waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull())
  })

  it('loads the client into the form', async () => {
    getClient.mockResolvedValue(company)
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Editar cliente' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^nome$/i)).toHaveValue('Padaria Central, Lda.')
    expect(screen.getByLabelText(/^nif$/i)).toHaveValue('501442600')
    expect(screen.getByLabelText(/^email$/i)).toHaveValue('geral@padaria.pt')
    expect(screen.getByRole('link', { name: 'Padaria Central, Lda.' })).toHaveAttribute('href', '/clients/1')
    expect(screen.queryByText(/o perfil fiscal preenche-se depois/i)).not.toBeInTheDocument()
  })

  it('shows the kind read-only, and says why', async () => {
    getClient.mockResolvedValue(company)
    renderPage()

    const kind = await screen.findByRole('combobox', { name: /^tipo$/i })
    expect(kind).toBeDisabled()
    expect(kind).toHaveAccessibleDescription(/não pode ser alterado/i)
  })

  // Spec §11: a diff bug could send nothing and "succeed" — assert the body.
  it('sends only the changed fields, plus kind', async () => {
    getClient.mockResolvedValue(company)
    updateClient.mockResolvedValue({ ...company, phone: '912345678' })
    renderPage()

    await userEvent.type(await screen.findByLabelText(/^telefone$/i), '912345678')
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    await vi.waitFor(() => {
      expect(updateClient).toHaveBeenCalledWith('1', { kind: 'COMPANY', phone: '912345678' })
    })
  })

  // Review Focus 3.
  it('sends kind alone when nothing changed, and still returns to the client', async () => {
    getClient.mockResolvedValue(company)
    updateClient.mockResolvedValue(company)
    const { router } = renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /^guardar$/i }))

    await vi.waitFor(() => expect(updateClient).toHaveBeenCalledWith('1', { kind: 'COMPANY' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/clients/1'))
  })

  it('refuses to empty a field that had a value', async () => {
    getClient.mockResolvedValue(company)
    renderPage()

    await userEvent.clear(await screen.findByLabelText(/^email$/i))
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    const email = screen.getByLabelText(/^email$/i)
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription(/ainda não pode ficar vazio/i)
    expect(updateClient).not.toHaveBeenCalled()
  })

  it('returns to the client page after saving', async () => {
    getClient.mockResolvedValue(company)
    updateClient.mockResolvedValue({ ...company, phone: '912345678' })
    const { router } = renderPage()

    await userEvent.type(await screen.findByLabelText(/^telefone$/i), '912345678')
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    expect(await screen.findByText('detalhe do cliente')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/clients/1')
  })

  // Review Focus 4.
  it("shows the server's refusal and keeps what was typed", async () => {
    getClient.mockResolvedValue(company)
    updateClient.mockRejectedValue(new ApiError('clients.archived', {}, 409))
    const { router } = renderPage()

    await userEvent.type(await screen.findByLabelText(/^telefone$/i), '912345678')
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    expect(await screen.findByText('O cliente está arquivado.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^telefone$/i)).toHaveValue('912345678')
    expect(router.state.location.pathname).toBe('/clients/1/edit')
  })

  // Review Focus 1: the diff is against the client as loaded, not as refetched.
  it('does not send a field the user never touched when the client refetches meanwhile', async () => {
    getClient.mockResolvedValue(company)
    updateClient.mockResolvedValue(company)
    const { queryClient } = renderPage()

    await userEvent.type(await screen.findByLabelText(/^telefone$/i), '912345678')
    queryClient.setQueryData(['client', '1'], { ...company, name: 'Padaria Renomeada, Lda.' })
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    await vi.waitFor(() => {
      expect(updateClient).toHaveBeenCalledWith('1', { kind: 'COMPANY', phone: '912345678' })
    })
  })

  // Review Focus 5.
  it('says the client was not found rather than showing an empty form', async () => {
    getClient.mockRejectedValue(new ApiError('common.not_found', {}, 404))
    renderPage('missing')

    expect(await screen.findByText('Registo não encontrado.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^nome$/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveAttribute('href', '/clients')
  })

  // A failed background refetch keeps the loaded data (status 'error' with
  // data); it must not unmount the form and discard what the user typed.
  it('keeps the form and typed edits when a background refetch fails', async () => {
    getClient.mockResolvedValue(company)
    const { queryClient } = renderPage()

    await userEvent.type(await screen.findByLabelText(/^telefone$/i), '912345678')
    getClient.mockRejectedValue(new ApiError('common.not_found', {}, 500))
    // TanStack batches observer notifications on a timer, so let it run
    // inside act before looking at the screen.
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['client', '1'] })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(queryClient.getQueryState(['client', '1'])?.status).toBe('error')
    expect(screen.getByLabelText(/^telefone$/i)).toHaveValue('912345678')
  })
})
