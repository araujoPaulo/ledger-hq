import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptCredentialItem, toBase64 } from '@ledger-hq/crypto'
import { ApiError } from '../api/client'
import { initI18n } from '../i18n'
import { ToastProvider } from '../ui'
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

const writeText = vi.fn()

let vaultKey: CryptoKey

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ToastProvider>
          <CredentialsSection clientId="client1" />
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

async function credentialFor(item: Record<string, string>, id = 'c1') {
  const { ciphertext, iv } = await encryptCredentialItem(vaultKey, item)
  return {
    id,
    clientId: 'client1',
    platformId: 'p1',
    label: 'Acesso principal',
    updatedAt: '2026-09-10T00:00:00.000Z',
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
  }
}

describe('CredentialsSection', () => {
  beforeEach(async () => {
    writeText.mockReset().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
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
    await screen.findByText(/ainda não há credenciais/i)
    await userEvent.click((await screen.findAllByRole('button', { name: /nova credencial/i }))[0]!)
    const dialog = await screen.findByRole('dialog', { name: /nova credencial/i })
    await userEvent.type(within(dialog).getByLabelText(/designação/i), 'Nova')
    await userEvent.type(within(dialog).getByLabelText(/utilizador/i), 'user2')
    await userEvent.type(within(dialog).getByLabelText(/^palavra-passe$/i), 'secret2')
    await userEvent.click(within(dialog).getByRole('button', { name: /^criar$/i }))

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

    expect(await screen.findByText('Acesso em cache', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Portal das Finanças')).toBeInTheDocument()
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

  it('copies the password, says the clipboard clears, and confirms with a toast', async () => {
    listCredentialsForClientMock.mockResolvedValue([await credentialFor({ username: 'user1', password: 'hunter2' })])
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))
    expect(await screen.findByText('Limpa ao fim de 30 s')).toBeInTheDocument()
    expect(screen.queryByText('hunter2')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^copiar$/i }))

    expect(writeText).toHaveBeenCalledWith('hunter2')
    const region = screen.getByRole('region', { name: /notificações/i })
    expect(await within(region).findByText(/palavra-passe copiada/i)).toBeInTheDocument()
  })

  it('copies the username plainly, with its own toast', async () => {
    listCredentialsForClientMock.mockResolvedValue([await credentialFor({ username: 'user1', password: 'hunter2' })])
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Copiar utilizador' }))

    expect(writeText).toHaveBeenCalledWith('user1')
    const region = screen.getByRole('region', { name: /notificações/i })
    expect(await within(region).findByText('Utilizador copiado.')).toBeInTheDocument()
  })

  // Review Focus 4: plain HTTP over Tailscale has no clipboard API.
  it('shows no "copied" toast, and throws nothing, when there is no clipboard', async () => {
    Object.assign(navigator, { clipboard: undefined })
    listCredentialsForClientMock.mockResolvedValue([await credentialFor({ username: 'user1', password: 'hunter2' })])
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^copiar$/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Copiar utilizador' }))

    // Give a rejected copy the same chance to (wrongly) toast as a successful one.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const region = screen.getByRole('region', { name: /notificações/i })
    expect(within(region).queryByText(/copiad/i)).not.toBeInTheDocument()
  })

  it('shows no "copied" toast when the browser denies the write', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    listCredentialsForClientMock.mockResolvedValue([await credentialFor({ username: 'user1', password: 'hunter2' })])
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^copiar$/i }))

    await new Promise((resolve) => setTimeout(resolve, 50))
    const region = screen.getByRole('region', { name: /notificações/i })
    expect(within(region).queryByText(/copiad/i)).not.toBeInTheDocument()
  })

  it('shows the current code grouped, with the seconds left in its step', async () => {
    listCredentialsForClientMock.mockResolvedValue([await credentialFor({ totpSecret: 'JBSWY3DPEHPK3PXP' })])
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))

    expect(await screen.findByText(/^\d{3} \d{3}$/)).toBeInTheDocument()
    expect(screen.getByText(/^\d{1,2} s restantes$/)).toBeInTheDocument()
  })

  it('changes the password through a dialog', async () => {
    listCredentialsForClientMock.mockResolvedValue([await credentialFor({ username: 'user1', password: 'hunter2' })])
    rotateCredentialMock.mockResolvedValue({})
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /mudar palavra-passe/i }))
    const dialog = await screen.findByRole('dialog', { name: /mudar palavra-passe/i })
    await userEvent.type(within(dialog).getByLabelText(/^palavra-passe$/i), 'new secret')
    await userEvent.click(within(dialog).getByRole('button', { name: /^confirmar$/i }))

    await waitFor(() => expect(rotateCredentialMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps the change-password dialog open, with its value and the error, when the change fails', async () => {
    listCredentialsForClientMock.mockResolvedValue([await credentialFor({ username: 'user1', password: 'hunter2' })])
    rotateCredentialMock.mockRejectedValue(new ApiError('common.not_found', {}, 404))
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /mudar palavra-passe/i }))
    const dialog = await screen.findByRole('dialog', { name: /mudar palavra-passe/i })
    await userEvent.type(within(dialog).getByLabelText(/^palavra-passe$/i), 'new secret')
    await userEvent.click(within(dialog).getByRole('button', { name: /^confirmar$/i }))

    expect(await within(dialog).findByText(/registo não encontrado/i)).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /mudar palavra-passe/i })).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^palavra-passe$/i)).toHaveValue('new secret')
  })

  it('keeps the new-credential dialog open, with its values and the error, when creating fails', async () => {
    listCredentialsForClientMock.mockResolvedValue([])
    createCredentialMock.mockRejectedValue(new ApiError('common.not_found', {}, 404))
    renderSection()

    await screen.findByText(/ainda não há credenciais/i)
    await userEvent.click((await screen.findAllByRole('button', { name: /nova credencial/i }))[0]!)
    const dialog = await screen.findByRole('dialog', { name: /nova credencial/i })
    await userEvent.type(within(dialog).getByLabelText(/designação/i), 'Nova')
    await userEvent.click(within(dialog).getByRole('button', { name: /^criar$/i }))

    expect(await within(dialog).findByText(/registo não encontrado/i)).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /nova credencial/i })).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/designação/i)).toHaveValue('Nova')
  })

  it('offers to create the first credential from the empty state', async () => {
    listCredentialsForClientMock.mockResolvedValue([])
    renderSection()

    expect(await screen.findByText(/ainda não há credenciais/i)).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: /nova credencial/i })
    expect(buttons).toHaveLength(2)

    await userEvent.click(buttons[1]!)
    expect(await screen.findByRole('dialog', { name: /nova credencial/i })).toBeInTheDocument()
  })

  it('does not schedule a clipboard clear for a copy that did not happen', async () => {
    Object.assign(navigator, { clipboard: undefined })
    listCredentialsForClientMock.mockResolvedValue([await credentialFor({ username: 'user1', password: 'hunter2' })])
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))
    await screen.findByText('Limpa ao fim de 30 s')

    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
      await userEvent.click(screen.getByRole('button', { name: /^copiar$/i }))
      // The clipboard appears only after the failed copy; a stray timer would use it.
      Object.assign(navigator, { clipboard })
      await vi.advanceTimersByTimeAsync(31_000)
      expect(clipboard.writeText).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not reopen the new-credential dialog after an auto-lock and re-unlock', async () => {
    listCredentialsForClientMock.mockResolvedValue([])
    renderSection()
    await screen.findByText(/ainda não há credenciais/i)
    await userEvent.click((await screen.findAllByRole('button', { name: /nova credencial/i }))[0]!)
    await screen.findByRole('dialog', { name: /nova credencial/i })

    act(() => lockVault())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    act(() => unlockVault(vaultKey))

    expect(await screen.findByText(/ainda não há credenciais/i)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('locks the vault from the section header', async () => {
    listCredentialsForClientMock.mockResolvedValue([])
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /bloquear cofre/i }))

    await waitFor(() => expect(screen.queryByRole('button', { name: /nova credencial/i })).not.toBeInTheDocument())
  })

  afterEach(() => {
    lockVault()
  })
})
