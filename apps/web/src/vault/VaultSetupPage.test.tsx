import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const setUpVaultMock = vi.hoisted(() => vi.fn())
vi.mock('./setup', () => ({ setUpVault: setUpVaultMock }))

const useSessionMock = vi.hoisted(() => vi.fn())
vi.mock('../auth/session', () => ({ useSession: useSessionMock }))

const { VaultSetupPage } = await import('./VaultSetupPage')

await initI18n()
// See LoginPage.test.tsx: jsdom reports "en-US" regardless of the host,
// overriding the pt-PT fallback these assertions rely on.
await i18next.changeLanguage('pt-PT')

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <VaultSetupPage />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('VaultSetupPage', () => {
  beforeEach(() => {
    setUpVaultMock.mockReset()
    useSessionMock.mockReturnValue({ data: { id: 'u1', email: 'paulo@example.com', locale: 'pt-PT' } })
  })

  it('shows the recovery code only after a successful setup, gated by the checkbox', async () => {
    setUpVaultMock.mockResolvedValue({ recoveryCode: 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z' })
    renderPage()

    await userEvent.type(screen.getByLabelText(/palavra-passe mestra/i), 'a long master password')
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }))

    expect(await screen.findByText('ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continuar/i })).toBeDisabled()

    await userEvent.click(screen.getByLabelText(/anotei o código/i))
    expect(screen.getByRole('button', { name: /continuar/i })).toBeEnabled()
  })
})
