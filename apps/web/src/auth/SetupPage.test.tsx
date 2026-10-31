import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { initI18n } from '../i18n'

const createAccount = vi.hoisted(() => vi.fn())
vi.mock('./credentials', () => ({ createAccount }))

const { SetupPage } = await import('./SetupPage')
const { AuthLayout } = await import('./AuthLayout')

await initI18n()
// See LoginPage.test.tsx: jsdom reports "en-US" regardless of the host,
// overriding the pt-PT fallback these assertions rely on.
await i18next.changeLanguage('pt-PT')

function renderWithProviders(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>{node}</I18nextProvider>
    </QueryClientProvider>,
  )
}

const renderPage = () => renderWithProviders(<SetupPage />)

describe('SetupPage', () => {
  beforeEach(() => {
    createAccount.mockReset()
  })

  afterEach(async () => {
    await i18next.changeLanguage('pt-PT')
  })

  it('introduces the one account and states the minimum length up front', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: /configura a tua conta/i })).toBeInTheDocument()
    expect(screen.getByText(/única conta deste ledger hq/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^palavra-passe mestra$/i)).toHaveAccessibleDescription('Pelo menos 12 caracteres.')
  })

  it('refuses a too-short master password before any derivation is attempted', async () => {
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/^palavra-passe mestra$/i), 'short1')
    await userEvent.type(screen.getByLabelText(/confirma a palavra-passe/i), 'short1')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    const password = screen.getByLabelText(/^palavra-passe mestra$/i)
    expect(password).toHaveAttribute('aria-invalid', 'true')
    // The hint says the same number, so query the alert, not the text.
    expect(screen.getByRole('alert')).toHaveTextContent(/pelo menos 12 caracteres/i)
    // Nothing was ever submitted: no account-creation call (and therefore
    // no Argon2 derivation) was attempted with the too-short password.
    expect(createAccount).not.toHaveBeenCalled()
  })

  it('shows a mismatch on the confirmation field', async () => {
    renderPage()

    await userEvent.type(screen.getByLabelText(/^palavra-passe mestra$/i), 'a long master password')
    await userEvent.type(screen.getByLabelText(/confirma a palavra-passe/i), 'a different long password')

    const confirmation = screen.getByLabelText(/confirma a palavra-passe/i)
    expect(confirmation).toHaveAttribute('aria-invalid', 'true')
    expect(confirmation).toHaveAccessibleDescription(/não coincidem/i)
    expect(screen.getByLabelText(/^palavra-passe mestra$/i)).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('uses new-password autocomplete on both password fields', () => {
    renderPage()

    expect(screen.getByLabelText(/email/i)).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText(/^palavra-passe mestra$/i)).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText(/confirma a palavra-passe/i)).toHaveAttribute('autocomplete', 'new-password')
  })

  it('submits once the master password meets the minimum length', async () => {
    createAccount.mockResolvedValue(undefined)
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/^palavra-passe mestra$/i), 'a long master password')
    await userEvent.type(screen.getByLabelText(/confirma a palavra-passe/i), 'a long master password')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    await vi.waitFor(() => {
      expect(createAccount).toHaveBeenCalledWith('paulo@example.com', 'a long master password', 'pt-PT')
    })
  })

  // Review Focus 5: the language chosen in the auth layout's corner is the
  // account's locale — the reason that menu is on this screen at all.
  it('creates the account in the language chosen from the language menu', async () => {
    createAccount.mockResolvedValue(undefined)
    renderWithProviders(
      <AuthLayout>
        <SetupPage />
      </AuthLayout>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Idioma' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'English' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /set up your account/i })).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/^master password$/i), 'a long master password')
    await userEvent.type(screen.getByLabelText(/confirm master password/i), 'a long master password')
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await vi.waitFor(() => {
      expect(createAccount).toHaveBeenCalledWith('paulo@example.com', 'a long master password', 'en-GB')
    })
  })
})
