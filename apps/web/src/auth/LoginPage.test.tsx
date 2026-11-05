import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

async function openRecovery() {
  renderPage()
  await userEvent.click(screen.getByRole('button', { name: /esqueceste a palavra-passe/i }))
}

describe('LoginPage', () => {
  beforeEach(() => {
    signIn.mockReset()
  })

  it('submits the email and master password', async () => {
    signIn.mockResolvedValue(undefined)
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/palavra-passe|master password/i), 'a long master password')
    await userEvent.click(screen.getByRole('button', { name: /^entrar$/i }))

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('paulo@example.com', 'a long master password')
    })
  })

  it('uses the autocomplete tokens password managers need', () => {
    renderPage()

    expect(screen.getByLabelText(/email/i)).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText(/palavra-passe mestra/i)).toHaveAttribute('autocomplete', 'current-password')
  })

  it('shows a translated message when the credentials are rejected', async () => {
    // A real ApiError, because ErrorMessage translates only instances of it.
    signIn.mockRejectedValue(new ApiError('auth.invalid_credentials', {}, 401))
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    // Long enough to clear the client-side minimum-length gate — this test
    // is about the server rejecting it, not the length check.
    await userEvent.type(screen.getByLabelText(/palavra-passe|master password/i), 'wrong password')
    await userEvent.click(screen.getByRole('button', { name: /^entrar$/i }))

    expect(await screen.findByText(/credenciais inválidas/i)).toBeInTheDocument()
  })

  it('refuses a too-short master password as the field’s own error, before calling the API', async () => {
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/palavra-passe|master password/i), 'short1')
    await userEvent.click(screen.getByRole('button', { name: /^entrar$/i }))

    const password = screen.getByLabelText(/palavra-passe mestra/i)
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAccessibleDescription(/pelo menos 12 caracteres/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/pelo menos 12 caracteres/i)
    expect(signIn).not.toHaveBeenCalled()
  })
})

describe('recovery mode', () => {
  beforeEach(() => {
    recoverVaultMock.mockReset()
  })

  it('switches to the recovery form and back', async () => {
    await openRecovery()
    expect(screen.getByRole('heading', { level: 1, name: /recuperar acesso/i })).toBeInTheDocument()
    expect(screen.getByText(/usa o código de recuperação/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /voltar a entrar/i }))
    expect(screen.getByRole('heading', { level: 1, name: /^entrar$/i })).toBeInTheDocument()
  })

  it('submits the recovery code and new password', async () => {
    recoverVaultMock.mockResolvedValue(undefined)
    await openRecovery()

    await userEvent.type(screen.getByLabelText(/código de recuperação/i), 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')
    await userEvent.type(screen.getByLabelText('Nova palavra-passe mestra'), 'a new long master password')
    await userEvent.type(screen.getByLabelText(/confirma a nova palavra-passe/i), 'a new long master password')
    await userEvent.click(screen.getByRole('button', { name: /^recuperar acesso$/i }))

    await vi.waitFor(() => {
      expect(recoverVaultMock).toHaveBeenCalledWith('a new long master password', 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')
    })
  })

  it('normalises a code typed in lower case without hyphens', async () => {
    recoverVaultMock.mockResolvedValue(undefined)
    await openRecovery()

    const code = screen.getByLabelText(/código de recuperação/i)
    await userEvent.type(code, 'abcdefghijklmnopqrstuvwxyz')
    expect(code).toHaveValue('ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')

    await userEvent.type(screen.getByLabelText('Nova palavra-passe mestra'), 'a new long master password')
    await userEvent.type(screen.getByLabelText(/confirma a nova palavra-passe/i), 'a new long master password')
    await userEvent.click(screen.getByRole('button', { name: /^recuperar acesso$/i }))

    await vi.waitFor(() => {
      expect(recoverVaultMock).toHaveBeenCalledWith('a new long master password', 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')
    })
  })

  // Review Focus 1: a pasted code longer than 31 characters (extra spaces)
  // must not be truncated before it is normalised — so the field has no
  // maxLength; the formatter caps the code itself.
  it('normalises a pasted code with extra spacing', async () => {
    await openRecovery()

    const code = screen.getByLabelText(/código de recuperação/i)
    expect(code).not.toHaveAttribute('maxlength')
    await userEvent.click(code)
    await userEvent.paste(' abcde  fghij  klmno  pqrst  uvwxy  z ')

    expect(code).toHaveValue('ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')

    recoverVaultMock.mockResolvedValue(undefined)
    await userEvent.type(screen.getByLabelText('Nova palavra-passe mestra'), 'a new long master password')
    await userEvent.type(screen.getByLabelText(/confirma a nova palavra-passe/i), 'a new long master password')
    await userEvent.click(screen.getByRole('button', { name: /^recuperar acesso$/i }))

    await vi.waitFor(() => {
      expect(recoverVaultMock).toHaveBeenCalledWith('a new long master password', 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')
    })
  })

  // Review Focus 2: re-grouping moves characters across hyphens; the caret
  // must follow the character just typed, or the next keystroke lands at the
  // end and scrambles the code.
  it('keeps the caret in place when typing in the middle of the code', async () => {
    await openRecovery()

    const code = screen.getByLabelText<HTMLInputElement>(/código de recuperação/i)
    await userEvent.type(code, 'ABCDEFGHIJ')
    expect(code).toHaveValue('ABCDE-FGHIJ')

    await userEvent.type(code, 'K', { initialSelectionStart: 3, initialSelectionEnd: 3 })
    expect(code).toHaveValue('ABCKD-EFGHI-J')
    expect(code.selectionStart).toBe(4)

    await userEvent.type(code, 'L', { skipClick: true })
    expect(code).toHaveValue('ABCKL-DEFGH-IJ')
  })

  it('keeps the caret when a rejected character is typed mid-code', async () => {
    await openRecovery()

    const code = screen.getByLabelText<HTMLInputElement>(/código de recuperação/i)
    await userEvent.type(code, 'ABCDEFGHIJ')
    await userEvent.type(code, '0', { initialSelectionStart: 3, initialSelectionEnd: 3 })
    expect(code).toHaveValue('ABCDE-FGHIJ')
    expect(code.selectionStart).toBe(3)

    await userEvent.type(code, 'K', { skipClick: true })
    expect(code).toHaveValue('ABCKD-EFGHI-J')
  })

  it('keeps the caret sensible on backspace right after a hyphen', async () => {
    await openRecovery()

    const code = screen.getByLabelText<HTMLInputElement>(/código de recuperação/i)
    await userEvent.type(code, 'ABCDEFGHIJ')
    await userEvent.type(code, '{Backspace}', { initialSelectionStart: 6, initialSelectionEnd: 6 })
    expect(code).toHaveValue('ABCDE-FGHIJ')
    expect(code.selectionStart).toBeLessThan(11)
    expect(code.selectionStart).toBe(5)
  })

  it('forward Delete right before a hyphen removes the next code character', async () => {
    await openRecovery()

    const code = screen.getByLabelText<HTMLInputElement>(/código de recuperação/i)
    await userEvent.type(code, 'ABCDEFGHIJ')
    await userEvent.type(code, '{Delete}', { initialSelectionStart: 5, initialSelectionEnd: 5 })
    expect(code).toHaveValue('ABCDE-GHIJ')
    expect(code.selectionStart).toBe(5)
  })

  it('moves focus to the new heading when switching between sign-in and recovery', async () => {
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: /esqueceste a palavra-passe/i }))
    expect(screen.getByRole('heading', { level: 1, name: /recuperar/i })).toHaveFocus()

    await userEvent.click(screen.getByRole('button', { name: /voltar/i }))
    expect(screen.getByRole('heading', { level: 1, name: /entrar/i })).toHaveFocus()
  })

  it('does not move the code caret when another field re-renders after a rejected character', async () => {
    await openRecovery()

    const code = screen.getByLabelText<HTMLInputElement>(/código de recuperação/i)
    await userEvent.type(code, 'ABCDEFGHIJ')
    await userEvent.type(code, '0', { initialSelectionStart: 3, initialSelectionEnd: 3 })
    code.setSelectionRange(2, 2)

    await userEvent.type(screen.getByLabelText('Nova palavra-passe mestra'), 'x')
    expect(code.selectionStart).toBe(2)
  })

  it('shows length and mismatch problems on the fields they belong to', async () => {
    await openRecovery()

    const newPassword = screen.getByLabelText('Nova palavra-passe mestra')
    const confirmation = screen.getByLabelText(/confirma a nova palavra-passe/i)

    await userEvent.type(newPassword, 'short1')
    expect(newPassword).toHaveAttribute('aria-invalid', 'true')
    expect(newPassword).toHaveAccessibleDescription(/pelo menos 12 caracteres/i)

    await userEvent.type(confirmation, 'short2')
    expect(confirmation).toHaveAttribute('aria-invalid', 'true')
    expect(confirmation).toHaveAccessibleDescription(/não coincidem/i)

    await userEvent.click(screen.getByRole('button', { name: /^recuperar acesso$/i }))
    expect(recoverVaultMock).not.toHaveBeenCalled()
  })

  it('turns off the browser’s own text assistance on the code', async () => {
    await openRecovery()

    const code = screen.getByLabelText(/código de recuperação/i)
    expect(code).toHaveAttribute('autocomplete', 'off')
    expect(code).toHaveAttribute('spellcheck', 'false')
    expect(code).toHaveAttribute('autocapitalize', 'characters')
    expect(code).toHaveAccessibleDescription(/seis grupos/i)
  })
})
