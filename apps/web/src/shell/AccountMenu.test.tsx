import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import type * as CredentialsModule from '../auth/credentials'
import type * as ApiClientModule from '../api/client'
import { ApiError } from '../api/client'

const signOut = vi.hoisted(() => vi.fn())
vi.mock('../auth/credentials', async (importOriginal) => {
  const actual = await importOriginal<typeof CredentialsModule>()
  return { ...actual, signOut }
})

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>()
  return { ...actual, apiFetch }
})

const { AccountMenu } = await import('./AccountMenu')
const { lockVault, unlockVault } = await import('../vault/vault-session')

await initI18n()
// See LoginPage.test.tsx: jsdom reports "en-US" regardless of the host,
// which would otherwise override the pt-PT fallback these assertions rely on.
await i18next.changeLanguage('pt-PT')

function renderMenu() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <AccountMenu />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

// The trigger is named by the session's own email: there is no key that means
// "account menu", and the user's address says more than "Account" would.
function trigger() {
  return screen.findByRole('button', { name: /paulo@example\.com/i })
}

describe('AccountMenu', () => {
  beforeEach(() => {
    signOut.mockReset()
    signOut.mockResolvedValue(undefined)
    apiFetch.mockReset()
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/auth/session') return { id: '1', email: 'paulo@example.com', locale: 'pt-PT' }
      if (path === '/auth/logout') return undefined
      throw new Error(`unexpected path in test: ${path}`)
    })
    lockVault()
  })

  it('opens on click and closes on Escape, returning focus to the trigger', async () => {
    renderMenu()
    const button = await trigger()

    await userEvent.click(button)
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(button).toHaveFocus()
  })

  it('shows the lock-vault item only once the vault is unlocked', async () => {
    renderMenu()

    await userEvent.click(await trigger())
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /bloquear cofre/i })).not.toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    unlockVault({ type: 'secret' } as CryptoKey)

    await userEvent.click(await trigger())
    expect(await screen.findByRole('menuitem', { name: /bloquear cofre/i })).toBeInTheDocument()

    lockVault()
  })

  it('signs out through signOut', async () => {
    renderMenu()

    await userEvent.click(await trigger())
    await userEvent.click(await screen.findByRole('menuitem', { name: /sair/i }))

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
  })

  // The login and setup screens render inside this shell with no session. The
  // language control is the one thing someone needs before they can sign in,
  // so the menu keeps it — and offers nothing it cannot do.
  it('offers language only, named for it, when there is no session', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/auth/session') throw new ApiError('auth.session_expired', {}, 401)
      throw new Error(`unexpected path in test: ${path}`)
    })
    renderMenu()

    const button = await screen.findByRole('button', { name: /idioma/i })
    await userEvent.click(button)

    expect(await screen.findByRole('menuitemradio', { name: 'Português' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /sair/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /bloquear cofre/i })).not.toBeInTheDocument()
  })

  // Rendering the signed-out trigger while the session is merely in flight
  // flashes a Languages icon on every authenticated page load.
  it('renders no trigger at all while the session is still loading', () => {
    apiFetch.mockImplementation(() => new Promise(() => {}))
    renderMenu()

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('switches locale from the language radio items', async () => {
    renderMenu()

    await userEvent.click(await trigger())
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'English' }))

    await waitFor(() => expect(i18next.language).toBe('en-GB'))
    await i18next.changeLanguage('pt-PT')
  })
})
