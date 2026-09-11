import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ apiFetch: apiFetchMock }))

const getVaultEnvelopeMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getVaultEnvelope: getVaultEnvelopeMock }))

const getVaultMetaMock = vi.hoisted(() => vi.fn())
const putVaultMetaMock = vi.hoisted(() => vi.fn())
vi.mock('./vault-db', () => ({ getVaultMeta: getVaultMetaMock, putVaultMeta: putVaultMetaMock }))

const { resolveEnvelope } = await import('./unlock')

describe('resolveEnvelope', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    getVaultEnvelopeMock.mockReset()
    getVaultMetaMock.mockReset()
    putVaultMetaMock.mockReset()
  })

  it('prefers the live envelope when the server is reachable', async () => {
    getVaultEnvelopeMock.mockResolvedValue({ protectedVaultKey: 'LIVE', setUpAt: '2026-09-10T00:00:00.000Z' })
    apiFetchMock.mockResolvedValue({ kdfSalt: 'SALT' })

    await expect(resolveEnvelope('paulo@example.com')).resolves.toEqual({
      kdfSalt: 'SALT',
      protectedVaultKey: 'LIVE',
      setUp: true,
      fromCache: false,
    })
  })

  it('reports not set up when the live envelope has no protected key', async () => {
    getVaultEnvelopeMock.mockResolvedValue({ protectedVaultKey: null, setUpAt: null })
    apiFetchMock.mockResolvedValue({ kdfSalt: 'SALT' })

    await expect(resolveEnvelope('paulo@example.com')).resolves.toMatchObject({ setUp: false })
  })

  it('falls back to the IndexedDB cache when the server is unreachable', async () => {
    getVaultEnvelopeMock.mockRejectedValue(new Error('offline'))
    getVaultMetaMock.mockResolvedValue({ id: 'singleton', kdfSalt: 'CACHED_SALT', protectedVaultKey: 'CACHED_KEY', lastSyncedAt: null })

    await expect(resolveEnvelope('paulo@example.com')).resolves.toEqual({
      kdfSalt: 'CACHED_SALT',
      protectedVaultKey: 'CACHED_KEY',
      setUp: true,
      fromCache: true,
    })
  })

  it('returns null when offline and nothing was ever cached', async () => {
    getVaultEnvelopeMock.mockRejectedValue(new Error('offline'))
    getVaultMetaMock.mockResolvedValue(undefined)

    await expect(resolveEnvelope('paulo@example.com')).resolves.toBeNull()
  })
})
