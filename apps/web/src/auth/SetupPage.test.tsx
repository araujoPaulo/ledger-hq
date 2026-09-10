import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { initI18n } from '../i18n'

const createAccount = vi.hoisted(() => vi.fn())
vi.mock('./credentials', () => ({ createAccount }))

const { SetupPage } = await import('./SetupPage')

await initI18n()
// See LoginPage.test.tsx: jsdom reports "en-US" regardless of the host,
// overriding the pt-PT fallback these assertions rely on.
await i18next.changeLanguage('pt-PT')

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <SetupPage />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('SetupPage', () => {
  it('refuses a too-short master password before any derivation is attempted', async () => {
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/^palavra-passe mestra$|^master password$/i), 'short1')
    await userEvent.type(screen.getByLabelText(/confirma a palavra-passe|confirm master password/i), 'short1')
    await userEvent.click(screen.getByRole('button', { name: /criar|create/i }))

    expect(screen.getByText(/pelo menos 12 caracteres|at least 12 characters/i)).toBeInTheDocument()
    // Nothing was ever submitted: no account-creation call (and therefore
    // no Argon2 derivation) was attempted with the too-short password.
    expect(createAccount).not.toHaveBeenCalled()
  })

  it('submits once the master password meets the minimum length', async () => {
    createAccount.mockResolvedValue(undefined)
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/^palavra-passe mestra$|^master password$/i), 'a long master password')
    await userEvent.type(
      screen.getByLabelText(/confirma a palavra-passe|confirm master password/i),
      'a long master password',
    )
    await userEvent.click(screen.getByRole('button', { name: /criar|create/i }))

    await vi.waitFor(() => {
      expect(createAccount).toHaveBeenCalledWith('paulo@example.com', 'a long master password', expect.any(String))
    })
  })
})
