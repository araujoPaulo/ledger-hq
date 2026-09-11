import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ apiFetch: apiFetchMock }))

const postVaultRecoverMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ postVaultRecover: postVaultRecoverMock }))

const unlockVaultMock = vi.hoisted(() => vi.fn())
vi.mock('./vault-session', () => ({ unlockVault: unlockVaultMock }))

const putVaultMetaMock = vi.hoisted(() => vi.fn())
vi.mock('./vault-db', () => ({ putVaultMeta: putVaultMetaMock }))

const { recoverVault } = await import('./recover')

// Generated the same way Task 1's fixtures are: a real recovery code wrapping
// a real vault key, so this test exercises the actual unwrap, not a stub.
async function realRecoveryEnvelope() {
  const { deriveRecoveryWrappingKey, generateRecoveryCode, generateVaultKey, toBase64, wrapVaultKey } = await import(
    '@ledger-hq/crypto'
  )
  const recoveryCode = generateRecoveryCode()
  const vaultKey = generateVaultKey()
  const wrappingKey = await deriveRecoveryWrappingKey(recoveryCode)
  const recoveryVaultKey = toBase64(await wrapVaultKey(vaultKey, wrappingKey))
  return { recoveryCode, recoveryVaultKey }
}

describe('recoverVault', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    postVaultRecoverMock.mockReset().mockResolvedValue(undefined)
    unlockVaultMock.mockReset()
    putVaultMetaMock.mockReset().mockResolvedValue(undefined)
  })

  it('unwraps with the real recovery code and posts a reset request', async () => {
    const { recoveryCode, recoveryVaultKey } = await realRecoveryEnvelope()
    apiFetchMock.mockResolvedValue({ recoveryVaultKey })

    await recoverVault('a new long master password', recoveryCode)

    expect(postVaultRecoverMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryAuthHash: expect.any(String),
        kdfSalt: expect.any(String),
        authHash: expect.any(String),
        protectedVaultKey: expect.any(String),
      }),
    )
    expect(unlockVaultMock).toHaveBeenCalledTimes(1)
    expect(putVaultMetaMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a wrong recovery code before ever calling the server', async () => {
    const { recoveryVaultKey } = await realRecoveryEnvelope()
    apiFetchMock.mockResolvedValue({ recoveryVaultKey })

    await expect(recoverVault('a new long master password', 'WRONG-CODE-WRONG-CODE-1')).rejects.toThrow()
    expect(postVaultRecoverMock).not.toHaveBeenCalled()
  })

  it('rejects when the vault was never set up', async () => {
    apiFetchMock.mockResolvedValue({ recoveryVaultKey: null })
    await expect(recoverVault('a new long master password', 'ANYTHING')).rejects.toThrow()
  })
})
