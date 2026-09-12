import { createHash, createHmac, randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ConfigService } from '@nestjs/config'
import { argon2Verify, argon2id } from 'hash-wasm'
import { uuidv7 } from 'uuidv7'
import { AppError } from '@ledger-hq/domain'
import type { BootstrapInput, LoginInput, RecoverVaultInput, SetUpVaultInput } from '@ledger-hq/domain'
import { KDF_PARAMS } from '@ledger-hq/crypto'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'

/**
 * Server-side parameters for hashing the auth hash again. Lighter than the
 * client-side KDF because the input is already 32 bytes of high-entropy key,
 * not a human-chosen password.
 */
const SERVER_HASH_PARAMS = {
  memorySize: 19456,
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
} as const

export type SessionUser = { id: string; email: string; locale: string }

export type VaultEnvelope = { protectedVaultKey: string | null; setUpAt: string | null }

/**
 * Verified against when the email does not exist, so `login` always pays the
 * same Argon2id cost whether the account is real or not — otherwise a
 * missing user would short-circuit before hashing and an attacker could
 * recover valid emails purely from response latency, defeating the same
 * "wrong address indistinguishable from wrong password" guarantee the decoy
 * KDF salt gives `kdfSaltFor`. Lazily computed on first use and memoised for
 * the life of the process, not per request — and lazily rather than eagerly
 * at module load, so a rejection only ever happens inside an awaited call
 * inside `login()` (where it becomes an ordinary thrown error the exception
 * filter handles) instead of as an unhandled promise rejection that would
 * otherwise terminate the process before anything ever awaited it.
 */
let dummyDigestPromise: Promise<string> | undefined

function getDummyDigest(): Promise<string> {
  dummyDigestPromise ??= argon2id({
    password: randomBytes(32),
    salt: randomBytes(16),
    ...SERVER_HASH_PARAMS,
    outputType: 'encoded',
  })

  return dummyDigestPromise
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async bootstrapRequired(): Promise<boolean> {
    return (await this.prisma.user.count()) === 0
  }

  /**
   * Returns the stored salt, or a deterministic decoy for unknown addresses so
   * that a wrong email cannot be distinguished from a wrong password.
   */
  async kdfSaltFor(email: string): Promise<{ kdfSalt: string; params: typeof KDF_PARAMS }> {
    const user = await this.prisma.user.findUnique({ where: { email } })

    if (user) {
      return { kdfSalt: Buffer.from(user.kdfSalt).toString('base64'), params: KDF_PARAMS }
    }

    const secret = this.config.getOrThrow<string>('AUTH_SALT_SECRET')
    const decoy = createHmac('sha256', secret).update(email).digest().subarray(0, 16)

    return { kdfSalt: decoy.toString('base64'), params: KDF_PARAMS }
  }

  async bootstrap(input: BootstrapInput): Promise<string> {
    if (!(await this.bootstrapRequired())) {
      throw new AppError('auth.already_bootstrapped', {}, 409)
    }

    const digest = await argon2id({
      password: Buffer.from(input.authHash, 'base64'),
      salt: randomBytes(16),
      ...SERVER_HASH_PARAMS,
      outputType: 'encoded',
    })

    const user = await this.prisma.user.create({
      data: {
        id: uuidv7(),
        email: input.email,
        kdfSalt: Buffer.from(input.kdfSalt, 'base64'),
        authHashDigest: digest,
        locale: input.locale,
      },
    })

    return this.createSession(user.id)
  }

  async getVaultEnvelope(userId: string): Promise<VaultEnvelope> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })

    return {
      protectedVaultKey: user.vaultProtectedKey ? Buffer.from(user.vaultProtectedKey).toString('base64') : null,
      setUpAt: user.vaultSetUpAt?.toISOString() ?? null,
    }
  }

  async assertVaultSetUp(): Promise<void> {
    const user = await this.prisma.user.findFirst()
    if (!user || user.vaultSetUpAt === null) throw new AppError('vault.not_set_up', {}, 409)
  }

  async getRecoveryEnvelope(): Promise<{ recoveryVaultKey: string | null }> {
    const user = await this.prisma.user.findFirst()

    return {
      recoveryVaultKey: user?.vaultRecoveryKey ? Buffer.from(user.vaultRecoveryKey).toString('base64') : null,
    }
  }

  async setUpVault(userId: string, input: SetUpVaultInput): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.vaultSetUpAt !== null) throw new AppError('vault.already_set_up', {}, 409)

    const recoveryAuthDigest = await argon2id({
      password: Buffer.from(input.recoveryAuthHash, 'base64'),
      salt: randomBytes(16),
      ...SERVER_HASH_PARAMS,
      outputType: 'encoded',
    })

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        vaultProtectedKey: Buffer.from(input.protectedVaultKey, 'base64'),
        vaultRecoveryKey: Buffer.from(input.recoveryVaultKey, 'base64'),
        vaultRecoveryAuthDigest: recoveryAuthDigest,
        vaultSetUpAt: new Date(),
      },
    })
  }

  /**
   * No session guard: this is how access is regained without one. The
   * server never sees the vault key or the recovery code — only
   * `recoveryAuthHash`, verified against the digest `setUpVault` stored,
   * the same timing-safe way `login` verifies `authHash` (see
   * `getDummyDigest` above: the expensive verify always runs, so response
   * latency cannot reveal whether a vault was ever set up).
   */
  async recoverVault(input: RecoverVaultInput): Promise<string> {
    const user = await this.prisma.user.findFirst()

    const valid = await argon2Verify({
      password: Buffer.from(input.recoveryAuthHash, 'base64'),
      hash: user?.vaultRecoveryAuthDigest ?? (await getDummyDigest()),
    })

    if (!user || !user.vaultRecoveryAuthDigest || !valid) {
      throw new AppError('vault.invalid_recovery_code', {}, 401)
    }

    const authHashDigest = await argon2id({
      password: Buffer.from(input.authHash, 'base64'),
      salt: randomBytes(16),
      ...SERVER_HASH_PARAMS,
      outputType: 'encoded',
    })

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        kdfSalt: Buffer.from(input.kdfSalt, 'base64'),
        authHashDigest,
        vaultProtectedKey: Buffer.from(input.protectedVaultKey, 'base64'),
      },
    })

    // Recovery is precisely the flow reached for after losing control of the
    // account credential — the one place where "reset the password, leave
    // every other session valid" is the wrong default. Every prior session
    // (up to SESSION_TTL_DAYS old) is revoked; only the fresh one below
    // remains.
    await this.prisma.session.deleteMany({ where: { userId: user.id } })

    return this.createSession(user.id)
  }

  async login(input: LoginInput): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } })

    // Always verify, even for a nonexistent user, against a fixed dummy
    // digest computed at the same cost — see `getDummyDigest` above.
    const valid = await argon2Verify({
      password: Buffer.from(input.authHash, 'base64'),
      hash: user?.authHashDigest ?? (await getDummyDigest()),
    })

    if (!user || !valid) {
      throw new AppError('auth.invalid_credentials', {}, 401)
    }

    return this.createSession(user.id)
  }

  async resolveSession(token: string): Promise<SessionUser> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    })

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new AppError('auth.session_expired', {}, 401)
    }

    return { id: session.user.id, email: session.user.email, locale: session.user.locale }
  }

  async revokeSession(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } })
  }

  private async createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url')
    const ttlDays = Number(this.config.get<string>('SESSION_TTL_DAYS') ?? '30')

    await this.prisma.session.create({
      data: {
        id: uuidv7(),
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      },
    })

    return token
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
