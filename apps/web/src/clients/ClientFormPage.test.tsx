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

const createClient = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ createClient }))

const { ClientFormPage } = await import('./ClientFormPage')

await initI18n()
// Same pin as ClientListPage.test.tsx and LoginPage.test.tsx: jsdom reports
// navigator.language as "en-US", overriding the pt-PT fallback these
// Portuguese-only assertions rely on.
await i18next.changeLanguage('pt-PT')

// Same fix as ClientListPage.test.tsx: the page renders `<Link>`/calls
// `useNavigate`, both of which need a `<RouterProvider>` ancestor (proven
// empirically) that the brief's bare `render(<ClientFormPage />)` does not
// supply. A minimal single-route router provides that context without
// pulling in the real app router's RequireSession gate.
function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute({ component: ClientFormPage })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/clients/new'] }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

// The brief's own first query in each test below is the synchronous
// `screen.getByLabelText`, which assumes the page renders synchronously.
// With the RouterProvider wrapper above (needed for Link/useNavigate), the
// first render pass is the router resolving its initial match, so the form
// is not yet in the DOM on the same tick — confirmed by the act() warnings
// this produced before the fix. Awaiting `findByLabelText` for the first
// query in each test (only) waits out that one microtask; every assertion
// after it is unchanged from the brief.
describe('ClientFormPage', () => {
  it('shows the legal form field for a company and hides the personal fields', async () => {
    renderPage()

    await userEvent.selectOptions(await screen.findByLabelText(/tipo|kind/i), 'COMPANY')

    expect(screen.getByLabelText(/forma jurídica|legal form/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/NISS|social security/i)).not.toBeInTheDocument()
  })

  it('shows the personal fields for an individual and hides the legal form', async () => {
    renderPage()

    await userEvent.selectOptions(await screen.findByLabelText(/tipo|kind/i), 'INDIVIDUAL')

    expect(screen.getByLabelText(/NISS|social security/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/forma jurídica|legal form/i)).not.toBeInTheDocument()
  })

  it('rejects an invalid tax number before calling the API', async () => {
    renderPage()

    await userEvent.selectOptions(await screen.findByLabelText(/tipo|kind/i), 'COMPANY')
    await userEvent.type(screen.getByLabelText(/nome|^name/i), 'Padaria')
    await userEvent.type(screen.getByLabelText(/NIF|tax number/i), '000000000')
    await userEvent.click(screen.getByRole('button', { name: /guardar|save/i }))

    expect(createClient).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('submits a valid company', async () => {
    createClient.mockResolvedValue({ id: '1' })
    renderPage()

    await userEvent.selectOptions(await screen.findByLabelText(/tipo|kind/i), 'COMPANY')
    await userEvent.type(screen.getByLabelText(/nome|^name/i), 'Padaria Central, Lda.')
    await userEvent.type(screen.getByLabelText(/NIF|tax number/i), '501442600')
    await userEvent.click(screen.getByRole('button', { name: /guardar|save/i }))

    await vi.waitFor(() => {
      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'COMPANY', taxId: '501442600', legalForm: 'LDA' }),
      )
    })
  })
})
