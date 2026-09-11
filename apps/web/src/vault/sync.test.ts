import { beforeEach, describe, expect, it, vi } from 'vitest'

const listPlatformsMock = vi.hoisted(() => vi.fn())
const syncCredentialsMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ listPlatforms: listPlatformsMock, syncCredentials: syncCredentialsMock }))

const getVaultMetaMock = vi.hoisted(() => vi.fn())
const putVaultMetaMock = vi.hoisted(() => vi.fn())
const putCachedCredentialsMock = vi.hoisted(() => vi.fn())
const putCachedPlatformsMock = vi.hoisted(() => vi.fn())
vi.mock('./vault-db', () => ({
  getVaultMeta: getVaultMetaMock,
  putVaultMeta: putVaultMetaMock,
  putCachedCredentials: putCachedCredentialsMock,
  putCachedPlatforms: putCachedPlatformsMock,
}))

const { syncVault } = await import('./sync')

describe('syncVault', () => {
  beforeEach(() => {
    listPlatformsMock.mockReset().mockResolvedValue([{ id: 'p1', name: 'X', url: null, authKind: 'PASSWORD' }])
    syncCredentialsMock.mockReset().mockResolvedValue([])
    getVaultMetaMock.mockReset()
    putVaultMetaMock.mockReset().mockResolvedValue(undefined)
    putCachedCredentialsMock.mockReset().mockResolvedValue(undefined)
    putCachedPlatformsMock.mockReset().mockResolvedValue(undefined)
  })

  it('syncs with no cursor on the very first run', async () => {
    getVaultMetaMock.mockResolvedValue(undefined)
    await syncVault()
    expect(syncCredentialsMock).toHaveBeenCalledWith(null)
    expect(putVaultMetaMock).not.toHaveBeenCalled() // nothing to update: no envelope cached yet
  })

  it('passes the cached lastSyncedAt as the cursor on later runs', async () => {
    getVaultMetaMock.mockResolvedValue({
      id: 'singleton',
      kdfSalt: 'AAAA',
      protectedVaultKey: 'BBBB',
      lastSyncedAt: '2026-09-01T00:00:00.000Z',
    })

    await syncVault()

    expect(syncCredentialsMock).toHaveBeenCalledWith('2026-09-01T00:00:00.000Z')
    expect(putVaultMetaMock).toHaveBeenCalledWith(
      expect.objectContaining({ kdfSalt: 'AAAA', protectedVaultKey: 'BBBB' }),
    )
  })

  it('caches every synced platform and credential', async () => {
    getVaultMetaMock.mockResolvedValue({ id: 'singleton', kdfSalt: 'A', protectedVaultKey: 'B', lastSyncedAt: null })
    syncCredentialsMock.mockResolvedValue([
      { id: 'c1', clientId: 'cl1', platformId: 'p1', label: 'x', updatedAt: '2026-09-10T00:00:00.000Z', ciphertext: 'AAAA', iv: 'BBBB' },
    ])

    await syncVault()

    expect(putCachedPlatformsMock).toHaveBeenCalledWith([{ id: 'p1', name: 'X', url: null, authKind: 'PASSWORD' }])
    expect(putCachedCredentialsMock).toHaveBeenCalledWith([
      { id: 'c1', clientId: 'cl1', platformId: 'p1', label: 'x', updatedAt: '2026-09-10T00:00:00.000Z', ciphertext: 'AAAA', iv: 'BBBB' },
    ])
  })
})
