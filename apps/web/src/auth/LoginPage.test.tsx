import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { initI18n } from '../i18n'

import { ApiError } from '../api/client'

const signIn = vi.hoisted(() => vi.fn())
vi.mock('./credentials', () => ({ signIn }))

const recoverVaultMock = vi.hoisted(() => vi.fn())
vi.mock('../vault/recover', () => ({ recoverVault: recoverVaultMock }))

const { LoginPage } = await import('./LoginPage')

await initI18n()
// jsdom reports navigator.language as "en-US", which initI18n reads to pick
// the initial locale — overriding the pt-PT fallback the assertion below
// relies on. Pin the language explicitly so the test is deterministic
// regardless of the host's locale detection.
await i18next.changeLanguage('pt-PT')

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <LoginPage />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('LoginPage', () => {
  it('submits the email and master password', async () => {
    signIn.mockResolvedValue(undefined)
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/palavra-passe|master password/i), 'a long master password')
    await userEvent.click(screen.getByRole('button', { name: /entrar|sign in/i }))

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('paulo@example.com', 'a long master password')
    })
  })

  it('shows a translated message when the credentials are rejected', async () => {
    // A real ApiError, because ErrorMessage translates only instances of it.
    signIn.mockRejectedValue(new ApiError('auth.invalid_credentials', {}, 401))
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    // Long enough to clear the client-side minimum-length gate (Finding 6) —
    // this test is about the server rejecting it, not the length check.
    await userEvent.type(screen.getByLabelText(/palavra-passe|master password/i), 'wrong password')
    await userEvent.click(screen.getByRole('button', { name: /entrar|sign in/i }))

    expect(await screen.findByText(/credenciais inválidas/i)).toBeInTheDocument()
  })

  it('refuses a too-short master password before deriving anything or calling the API', async () => {
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/palavra-passe|master password/i), 'short1')
    await userEvent.click(screen.getByRole('button', { name: /entrar|sign in/i }))

    expect(screen.getByText(/pelo menos 12 caracteres|at least 12 characters/i)).toBeInTheDocument()
    expect(signIn).not.toHaveBeenCalled()
  })
})

describe('recovery mode', () => {
  beforeEach(() => {
    recoverVaultMock.mockReset()
  })

  it('switches to the recovery form and back', async () => {
    renderPage() // this file's existing render helper
    await userEvent.click(screen.getByRole('button', { name: /esqueceste a palavra-passe/i }))
    expect(screen.getByRole('heading', { name: /recuperar acesso/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /voltar a entrar/i }))
    expect(screen.getByRole('heading', { name: /entrar/i })).toBeInTheDocument()
  })

  it('submits the recovery code and new password', async () => {
    recoverVaultMock.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /esqueceste a palavra-passe/i }))

    await userEvent.type(screen.getByLabelText(/código de recuperação/i), 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')
    await userEvent.type(screen.getByLabelText('Nova palavra-passe mestra'), 'a new long master password')
    await userEvent.type(screen.getByLabelText(/confirma a nova palavra-passe/i), 'a new long master password')
    await userEvent.click(screen.getByRole('button', { name: /^recuperar acesso$/i }))

    await vi.waitFor(() => {
      expect(recoverVaultMock).toHaveBeenCalledWith('a new long master password', 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')
    })
  })
})
