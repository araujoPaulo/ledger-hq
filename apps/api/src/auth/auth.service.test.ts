import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('hash-wasm', () => ({
  argon2Verify: vi.fn(),
  argon2id: vi.fn(),
}))

import { argon2Verify, argon2id } from 'hash-wasm'
import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../common/prisma.service.js'
import { AuthService } from './auth.service.js'

const argon2VerifyMock = vi.mocked(argon2Verify)
const argon2idMock = vi.mocked(argon2id)

const SOME_AUTH_HASH = 'A'.repeat(43) + '='

function fakeConfig(): ConfigService {
  return { get: vi.fn(), getOrThrow: vi.fn() } as unknown as ConfigService
}

function fakePrisma(user: unknown): PrismaService {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      findFirst: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue(user),
    },
    session: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaService
}

/**
 * The brief's own `login` short-circuited on a missing user
 * (`user !== null && (await argon2Verify(...))`), skipping the deliberately
 * expensive Argon2id verification entirely and returning fast — turning
 * response latency into an account-enumeration oracle. This test does not
 * assert on timing (unreliable in CI); it asserts the one thing that
 * distinguishes the fixed code from the regression: whether the expensive
 * call happens at all.
 */
describe('AuthService#login', () => {
  beforeEach(() => {
    argon2VerifyMock.mockReset()
    argon2idMock.mockReset()
    argon2idMock.mockResolvedValue('dummy-encoded-digest')
  })

  it('calls argon2Verify exactly once when the user does not exist', async () => {
    argon2VerifyMock.mockResolvedValue(false)
    const service = new AuthService(fakePrisma(null), fakeConfig())

    await expect(service.login({ email: 'nobody@example.com', authHash: SOME_AUTH_HASH })).rejects.toMatchObject({
      code: 'auth.invalid_credentials',
    })

    expect(argon2VerifyMock).toHaveBeenCalledTimes(1)
  })

  it('calls argon2Verify exactly once when the user exists but the hash is wrong', async () => {
    argon2VerifyMock.mockResolvedValue(false)
    const user = { id: 'u1', email: 'paulo@example.com', authHashDigest: 'stored-digest', locale: 'pt-PT' }
    const service = new AuthService(fakePrisma(user), fakeConfig())

    await expect(service.login({ email: 'paulo@example.com', authHash: SOME_AUTH_HASH })).rejects.toMatchObject({
      code: 'auth.invalid_credentials',
    })

    expect(argon2VerifyMock).toHaveBeenCalledTimes(1)
  })

  it('verifies against the user\'s own digest when the user exists', async () => {
    argon2VerifyMock.mockResolvedValue(true)
    const user = { id: 'u1', email: 'paulo@example.com', authHashDigest: 'stored-digest', locale: 'pt-PT' }
    const service = new AuthService(fakePrisma(user), fakeConfig())

    await service.login({ email: 'paulo@example.com', authHash: SOME_AUTH_HASH })

    expect(argon2VerifyMock).toHaveBeenCalledWith(expect.objectContaining({ hash: 'stored-digest' }))
  })

  it('never lets a nonexistent user through even if the dummy digest were somehow to verify', async () => {
    // Guards against a regression where the `!user` check is dropped: the
    // dummy digest must never become an authentication path.
    argon2VerifyMock.mockResolvedValue(true)
    const service = new AuthService(fakePrisma(null), fakeConfig())

    await expect(service.login({ email: 'nobody@example.com', authHash: SOME_AUTH_HASH })).rejects.toMatchObject({
      code: 'auth.invalid_credentials',
    })
  })
})

describe('AuthService#recoverVault', () => {
  beforeEach(() => {
    argon2VerifyMock.mockReset()
    argon2idMock.mockReset()
    argon2idMock.mockResolvedValue('dummy-encoded-digest')
  })

  it('calls argon2Verify exactly once even when the vault was never set up', async () => {
    argon2VerifyMock.mockResolvedValue(false)
    const user = { id: 'u1', email: 'paulo@example.com', vaultRecoveryAuthDigest: null }
    const service = new AuthService(fakePrisma(user), fakeConfig())

    await expect(
      service.recoverVault({ recoveryAuthHash: SOME_AUTH_HASH, kdfSalt: SOME_AUTH_HASH, authHash: SOME_AUTH_HASH, protectedVaultKey: SOME_AUTH_HASH }),
    ).rejects.toMatchObject({ code: 'vault.invalid_recovery_code' })

    expect(argon2VerifyMock).toHaveBeenCalledTimes(1)
  })

  it('verifies against the stored recovery digest when one exists', async () => {
    argon2VerifyMock.mockResolvedValue(true)
    const user = { id: 'u1', email: 'paulo@example.com', vaultRecoveryAuthDigest: 'stored-recovery-digest' }
    const service = new AuthService(fakePrisma(user), fakeConfig())

    await service.recoverVault({
      recoveryAuthHash: SOME_AUTH_HASH,
      kdfSalt: SOME_AUTH_HASH,
      authHash: SOME_AUTH_HASH,
      protectedVaultKey: SOME_AUTH_HASH,
    })

    expect(argon2VerifyMock).toHaveBeenCalledWith(expect.objectContaining({ hash: 'stored-recovery-digest' }))
  })
})
