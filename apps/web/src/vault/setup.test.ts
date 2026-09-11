import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ apiFetch: apiFetchMock }))

const postVaultSetupMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ postVaultSetup: postVaultSetupMock }))

const unlockVaultMock = vi.hoisted(() => vi.fn())
vi.mock('./vault-session', () => ({ unlockVault: unlockVaultMock }))

const putVaultMetaMock = vi.hoisted(() => vi.fn())
vi.mock('./vault-db', () => ({ putVaultMeta: putVaultMetaMock }))

const { setUpVault } = await import('./setup')

describe('setUpVault', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    postVaultSetupMock.mockReset().mockResolvedValue(undefined)
    unlockVaultMock.mockReset()
    putVaultMetaMock.mockReset().mockResolvedValue(undefined)
  })

  it('fetches the salt, verifies the password by logging in, and stores the envelope', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/auth/kdf')) return Promise.resolve({ kdfSalt: 'AAAAAAAAAAAAAAAAAAAAAA==' })
      if (path === '/auth/login') return Promise.resolve(undefined)
      throw new Error(`unexpected path ${path}`)
    })

    const result = await setUpVault('paulo@example.com', 'a long master password')

    expect(apiFetchMock).toHaveBeenCalledWith('/auth/login', expect.objectContaining({ method: 'POST' }))
    expect(postVaultSetupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        protectedVaultKey: expect.any(String),
        recoveryVaultKey: expect.any(String),
        recoveryAuthHash: expect.any(String),
      }),
    )
    expect(unlockVaultMock).toHaveBeenCalledTimes(1)
    expect(putVaultMetaMock).toHaveBeenCalledTimes(1)
    expect(result.recoveryCode).toMatch(/^[A-Z2-7-]+$/)
  })

  it('never calls postVaultSetup when the login verification rejects', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/auth/kdf')) return Promise.resolve({ kdfSalt: 'AAAAAAAAAAAAAAAAAAAAAA==' })
      if (path === '/auth/login') return Promise.reject(new Error('invalid credentials'))
      throw new Error(`unexpected path ${path}`)
    })

    await expect(setUpVault('paulo@example.com', 'wrong password')).rejects.toThrow()
    expect(postVaultSetupMock).not.toHaveBeenCalled()
  })
})
