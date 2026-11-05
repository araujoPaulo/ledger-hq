import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ApiError } from '../api/client'
import type * as ApiClientModule from '../api/client'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>()
  return { ...actual, apiFetch }
})

const { RequireSession } = await import('./RequireSession')

await initI18n()
// See LoginPage.test.tsx: jsdom reports "en-US" regardless of the host.
await i18next.changeLanguage('pt-PT')

function renderGate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RequireSession>
          <nav aria-label="shell">o shell</nav>
        </RequireSession>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('RequireSession', () => {
  beforeEach(() => {
    apiFetch.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the splash while the session is resolving', () => {
    apiFetch.mockImplementation(() => new Promise(() => {}))
    renderGate()

    expect(screen.getByText('A carregar')).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('keeps the splash while the session is still pending after bootstrap resolved', () => {
    apiFetch.mockImplementation((path: string) =>
      path === '/auth/bootstrap-required' ? Promise.resolve({ required: false }) : new Promise(() => {}),
    )
    renderGate()

    return vi.waitFor(() => {
      // bootstrap has resolved; the session never does
      expect(apiFetch).toHaveBeenCalledWith('/auth/session')
    }).then(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(screen.getByText('A carregar')).toBeInTheDocument()
      expect(screen.queryByText('o shell')).not.toBeInTheDocument()
    })
  })

  it('shows account setup in the auth layout on a fresh install', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/auth/bootstrap-required') return { required: true }
      if (path === '/auth/session') throw new ApiError('auth.session_expired', {}, 401)
      throw new Error(`unexpected path in test: ${path}`)
    })
    renderGate()

    expect(await screen.findByRole('heading', { level: 1, name: /configura a tua conta/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Idioma' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('shows sign-in in the auth layout without a session, and no shell at all', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/auth/bootstrap-required') return { required: false }
      if (path === '/auth/session') throw new ApiError('auth.session_expired', {}, 401)
      throw new Error(`unexpected path in test: ${path}`)
    })
    renderGate()

    expect(await screen.findByRole('heading', { level: 1, name: /entrar/i })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByText('o shell')).not.toBeInTheDocument()
  })

  // Review Focus 3: offline on first load, nothing cached. Both requests fail
  // as the browser fails them — `fetch` itself rejects with a TypeError, which
  // the real apiFetch turns into ApiError('common.offline'). The gate must
  // land on sign-in, not hang on the splash.
  it('shows sign-in when both requests fail at the network', async () => {
    const actual = await vi.importActual<typeof ApiClientModule>('../api/client')
    apiFetch.mockImplementation(actual.apiFetch)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    renderGate()

    expect(await screen.findByRole('heading', { level: 1, name: /entrar/i })).toBeInTheDocument()
    expect(screen.queryByText('A carregar')).not.toBeInTheDocument()
  })

  it('renders the shell once there is a session', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/auth/bootstrap-required') return { required: false }
      if (path === '/auth/session') return { id: '1', email: 'paulo@example.com', locale: 'pt-PT' }
      throw new Error(`unexpected path in test: ${path}`)
    })
    renderGate()

    expect(await screen.findByRole('navigation', { name: 'shell' })).toBeInTheDocument()
    expect(screen.queryByText('A carregar')).not.toBeInTheDocument()
  })
})
