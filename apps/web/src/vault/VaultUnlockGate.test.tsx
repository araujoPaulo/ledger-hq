import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { lockVault } from './vault-session'

const resolveEnvelopeMock = vi.hoisted(() => vi.fn())
const unlockWithPasswordMock = vi.hoisted(() => vi.fn())
vi.mock('./unlock', () => ({ resolveEnvelope: resolveEnvelopeMock, unlockWithPassword: unlockWithPasswordMock }))

const useSessionMock = vi.hoisted(() => vi.fn())
vi.mock('../auth/session', () => ({ useSession: useSessionMock }))

const { VaultUnlockGate } = await import('./VaultUnlockGate')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderGate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute({
    component: () => (
      <VaultUnlockGate>
        {/* eslint-disable-next-line i18next/no-literal-string -- test fixture content, not user-facing copy */}
        <p>secret content</p>
      </VaultUnlockGate>
    ),
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('VaultUnlockGate', () => {
  beforeEach(() => {
    lockVault()
    resolveEnvelopeMock.mockReset()
    unlockWithPasswordMock.mockReset()
    useSessionMock.mockReturnValue({ data: { id: 'u1', email: 'paulo@example.com', locale: 'pt-PT' } })
  })

  it('prompts to set up the vault when none exists', async () => {
    resolveEnvelopeMock.mockResolvedValue(null)
    renderGate()
    expect(await screen.findByText(/ainda não foi configurado/i)).toBeInTheDocument()
  })

  it('shows an unlock form and reveals children once unlocked', async () => {
    resolveEnvelopeMock.mockResolvedValue({ kdfSalt: 'AAAA', protectedVaultKey: 'BBBB', setUp: true, fromCache: false })
    unlockWithPasswordMock.mockImplementation(async () => {
      const { unlockVault } = await import('./vault-session')
      unlockVault({ type: 'secret' } as CryptoKey)
    })
    renderGate()

    await userEvent.type(await screen.findByLabelText(/palavra-passe mestra/i), 'a long master password')
    await userEvent.click(screen.getByRole('button', { name: /desbloquear/i }))

    expect(await screen.findByText('secret content')).toBeInTheDocument()
  })

  it('shows a translated error on a wrong password', async () => {
    resolveEnvelopeMock.mockResolvedValue({ kdfSalt: 'AAAA', protectedVaultKey: 'BBBB', setUp: true, fromCache: false })
    unlockWithPasswordMock.mockRejectedValue(new Error('OperationError'))
    renderGate()

    await userEvent.type(await screen.findByLabelText(/palavra-passe mestra/i), 'wrong password')
    await userEvent.click(screen.getByRole('button', { name: /desbloquear/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorreta/i)
  })
})
