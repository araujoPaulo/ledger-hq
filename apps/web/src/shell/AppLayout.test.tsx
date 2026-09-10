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
import { describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ApiError } from '../api/client'
import type * as CredentialsModule from '../auth/credentials'
import type * as ApiClientModule from '../api/client'

// The button must call the real `signOut` (not a stand-in), so its own
// `/auth/logout` request participates in the same fake network below —
// only the network boundary (`apiFetch`) is replaced.
const signOut = vi.hoisted(() => vi.fn())
vi.mock('../auth/credentials', async (importOriginal) => {
  const actual = await importOriginal<typeof CredentialsModule>()
  signOut.mockImplementation(actual.signOut)
  return { ...actual, signOut }
})

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>()
  return { ...actual, apiFetch }
})

const { AppLayout } = await import('./AppLayout')

await initI18n()
// See LoginPage.test.tsx: jsdom reports "en-US" regardless of the host,
// which would otherwise override the pt-PT fallback these assertions rely on.
await i18next.changeLanguage('pt-PT')

function renderLayout() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute({ component: AppLayout })
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null })
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

describe('AppLayout', () => {
  it('signs the user out and returns them to the login screen', async () => {
    // A minimal fake network: session is valid until `/auth/logout` is hit,
    // after which the session query (refetched once invalidated) is
    // rejected — the same shape a real logout produces server-side.
    let loggedOut = false
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/auth/bootstrap-required') return { required: false }
      if (path === '/auth/session') {
        if (loggedOut) throw new ApiError('auth.session_expired', {}, 401)
        return { id: '1', email: 'paulo@example.com', locale: 'pt-PT' }
      }
      if (path === '/auth/logout') {
        loggedOut = true
        return undefined
      }
      throw new Error(`unexpected path in test: ${path}`)
    })

    renderLayout()

    // Sanity check: while signed in, the index route (not the login page)
    // is what's showing.
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /entrar|sign in/i })).not.toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /sair|sign out/i }))

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledOnce()
    })

    // Stronger assertion than "the query was invalidated": the session
    // query re-fetches, fails, and RequireSession renders the login page.
    // Scoped to the heading (not the button, which shares the same
    // translated "Entrar"/"Sign in" text).
    expect(await screen.findByRole('heading', { name: /entrar|sign in/i })).toBeInTheDocument()
  })
})
