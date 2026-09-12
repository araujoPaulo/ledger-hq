import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptCredentialItem, toBase64 } from '@ledger-hq/crypto'
import { initI18n } from '../i18n'
import { lockVault, unlockVault } from './vault-session'

const listCredentialsForClientMock = vi.hoisted(() => vi.fn())
const listPlatformsMock = vi.hoisted(() => vi.fn())
const createCredentialMock = vi.hoisted(() => vi.fn())
const rotateCredentialMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({
  listCredentialsForClient: listCredentialsForClientMock,
  listPlatforms: listPlatformsMock,
  createCredential: createCredentialMock,
  rotateCredential: rotateCredentialMock,
}))

const listCachedCredentialsMock = vi.hoisted(() => vi.fn())
const listCachedPlatformsMock = vi.hoisted(() => vi.fn())
vi.mock('./vault-db', () => ({
  listCachedCredentials: listCachedCredentialsMock,
  listCachedPlatforms: listCachedPlatformsMock,
}))

const { CredentialsSection } = await import('./CredentialsSection')

await initI18n()
await i18next.changeLanguage('pt-PT')

Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })

let vaultKey: CryptoKey

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <CredentialsSection clientId="client1" />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('CredentialsSection', () => {
  beforeEach(async () => {
    vaultKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    unlockVault(vaultKey)
    listPlatformsMock.mockResolvedValue([{ id: 'p1', name: 'Portal das Finanças', url: null, authKind: 'PASSWORD' }])
    listCredentialsForClientMock.mockReset()
    createCredentialMock.mockReset()
    rotateCredentialMock.mockReset()
    listCachedCredentialsMock.mockReset()
    listCachedPlatformsMock.mockReset()
  })

  it('decrypts and reveals a credential on demand', async () => {
    const { ciphertext, iv } = await encryptCredentialItem(vaultKey, { username: 'user1', password: 'hunter2' })
    listCredentialsForClientMock.mockResolvedValue([
      {
        id: 'c1',
        clientId: 'client1',
        platformId: 'p1',
        label: 'Acesso principal',
        updatedAt: '2026-09-10T00:00:00.000Z',
        ciphertext: toBase64(ciphertext),
        iv: toBase64(iv),
      },
    ])

    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))

    expect(await screen.findByText(/user1/)).toBeInTheDocument()
  })

  it('encrypts before creating a credential', async () => {
    listCredentialsForClientMock.mockResolvedValue([])
    createCredentialMock.mockResolvedValue({
      id: 'c2',
      clientId: 'client1',
      platformId: 'p1',
      label: 'Nova',
      updatedAt: '2026-09-10T00:00:00.000Z',
      ciphertext: 'x',
      iv: 'y',
    })

    renderSection()
    await userEvent.type(await screen.findByLabelText(/designação/i), 'Nova')
    await userEvent.type(screen.getByLabelText(/utilizador/i), 'user2')
    await userEvent.type(screen.getByLabelText(/palavra-passe/i), 'secret2')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    await vi.waitFor(() => expect(createCredentialMock).toHaveBeenCalledTimes(1))
    const call = createCredentialMock.mock.calls[0]![0]
    expect(call.ciphertext).not.toContain('user2')
    expect(call.ciphertext).not.toContain('secret2')
    // Regression check: the platform select must default to a real platform
    // id, not an empty string left over from before `listPlatforms` resolved
    // — this client detail page is the FIRST place platforms load in this
    // test, unlike a session that already visited /vault/platforms.
    expect(call.platformId).toBe('p1')

    const { decryptCredentialItem, fromBase64 } = await import('@ledger-hq/crypto')
    await expect(
      decryptCredentialItem(vaultKey, fromBase64(call.ciphertext), fromBase64(call.iv)),
    ).resolves.toMatchObject({ username: 'user2', password: 'secret2' })
  })

  it('falls back to the cached credentials and platforms when the network is unreachable', async () => {
    listCredentialsForClientMock.mockRejectedValue(new Error('offline'))
    listPlatformsMock.mockRejectedValue(new Error('offline'))
    listCachedCredentialsMock.mockResolvedValue([
      {
        id: 'c4',
        clientId: 'client1',
        platformId: 'p1',
        label: 'Acesso em cache',
        updatedAt: '2026-09-10T00:00:00.000Z',
        ciphertext: 'AAAA',
        iv: 'BBBB',
      },
    ])
    listCachedPlatformsMock.mockResolvedValue([{ id: 'p1', name: 'Portal das Finanças', url: null, authKind: 'PASSWORD' }])

    renderSection()

    expect(await screen.findByText(/portal das finanças — acesso em cache/i)).toBeInTheDocument()
    expect(listCachedCredentialsMock).toHaveBeenCalledWith('client1')
    expect(listCachedPlatformsMock).toHaveBeenCalledTimes(1)
  })

  it('clears a revealed credential when the vault locks', async () => {
    const { ciphertext, iv } = await encryptCredentialItem(vaultKey, { username: 'user3' })
    listCredentialsForClientMock.mockResolvedValue([
      {
        id: 'c3',
        clientId: 'client1',
        platformId: 'p1',
        label: 'x',
        updatedAt: '2026-09-10T00:00:00.000Z',
        ciphertext: toBase64(ciphertext),
        iv: toBase64(iv),
      },
    ])

    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))
    expect(await screen.findByText(/user3/)).toBeInTheDocument()

    lockVault()

    await vi.waitFor(() => expect(screen.queryByText(/user3/)).not.toBeInTheDocument())
  })

  afterEach(() => {
    lockVault()
  })
})
