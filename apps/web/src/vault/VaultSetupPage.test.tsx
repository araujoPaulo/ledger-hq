import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ToastProvider } from '../ui'

const setUpVaultMock = vi.hoisted(() => vi.fn())
vi.mock('./setup', () => ({ setUpVault: setUpVaultMock }))

const useSessionMock = vi.hoisted(() => vi.fn())
vi.mock('../auth/session', () => ({ useSession: useSessionMock }))

const { VaultSetupPage } = await import('./VaultSetupPage')

await initI18n()
// See LoginPage.test.tsx: jsdom reports "en-US" regardless of the host,
// overriding the pt-PT fallback these assertions rely on.
await i18next.changeLanguage('pt-PT')

const EMAIL = 'paulo@example.com'
const CODE = 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z'

function renderPage(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ToastProvider>
          <VaultSetupPage />
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

async function completeStepOne(): Promise<void> {
  await userEvent.type(screen.getByLabelText(/palavra-passe mestra/i), 'a long master password')
  await userEvent.click(screen.getByRole('button', { name: /continuar/i }))
}

describe('VaultSetupPage', () => {
  beforeEach(() => {
    setUpVaultMock.mockReset()
    useSessionMock.mockReturnValue({ data: { id: 'u1', email: EMAIL, locale: 'pt-PT' } })
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  it('starts on step 1 of 2, explaining why the password is asked again', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Configura o cofre' })).toBeInTheDocument()
    expect(screen.getByText('Passo 1 de 2')).toBeInTheDocument()
    expect(screen.getByText(/só a tua palavra-passe mestra abre/i)).toBeInTheDocument()
  })

  it('passes the session email and the typed password to setup', async () => {
    setUpVaultMock.mockResolvedValue({ recoveryCode: CODE })
    renderPage()

    await completeStepOne()

    expect(setUpVaultMock).toHaveBeenCalledWith(EMAIL, 'a long master password')
  })

  it('shows the recovery code on step 2 only after a successful setup, gated by the checkbox', async () => {
    setUpVaultMock.mockResolvedValue({ recoveryCode: CODE })
    renderPage()

    await completeStepOne()

    expect(await screen.findByText('Passo 2 de 2')).toBeInTheDocument()
    expect(screen.getByText('Anota isto agora')).toBeInTheDocument()
    const groups = within(screen.getByRole('list', { name: /código de recuperação/i }))
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(groups).toEqual(['ABCDE', 'FGHIJ', 'KLMNO', 'PQRST', 'UVWXY', 'Z'])

    expect(screen.getByRole('button', { name: /continuar/i })).toBeDisabled()
    await userEvent.click(screen.getByLabelText(/anotei o código/i))
    expect(screen.getByRole('button', { name: /continuar/i })).toBeEnabled()
  })

  // F3: the form that had focus is gone; focus must not fall to <body>.
  it('moves focus to the step-2 title when the code appears', async () => {
    setUpVaultMock.mockResolvedValue({ recoveryCode: CODE })
    renderPage()

    await completeStepOne()

    const title = await screen.findByText('Anota isto agora')
    await waitFor(() => expect(document.activeElement).toContainElement(title))
    expect(document.activeElement).not.toBe(document.body)
  })

  it('copies the code from step 2 and confirms it with a toast', async () => {
    setUpVaultMock.mockResolvedValue({ recoveryCode: CODE })
    renderPage()

    await completeStepOne()
    await userEvent.click(await screen.findByRole('button', { name: /copiar código/i }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CODE)
    // Found twice while Radix's hidden announcer holds a copy (see Task 7).
    expect(await screen.findAllByText(/código copiado/i)).not.toHaveLength(0)
  })

  it('stays on step 1 with the error when setup fails', async () => {
    setUpVaultMock.mockRejectedValue(new Error('boom'))
    renderPage()

    await completeStepOne()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Passo 1 de 2')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /código de recuperação/i })).not.toBeInTheDocument()
  })

  // Review Focus 1: the envelope query cached "not set up" before this page
  // ran. Once setup succeeds that entry is wrong, and the gate and the Vault
  // page would both read it the next time the vault locks.
  it('drops the cached envelope once the vault is set up', async () => {
    setUpVaultMock.mockResolvedValue({ recoveryCode: CODE })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['vault-envelope-resolved', EMAIL], {
      kdfSalt: 'salt',
      protectedVaultKey: 'key',
      setUp: false,
      fromCache: false,
    })
    renderPage(queryClient)

    await completeStepOne()
    await screen.findByText('Passo 2 de 2')

    expect(queryClient.getQueryData(['vault-envelope-resolved', EMAIL])).toBeUndefined()
  })
})
