import { Injectable } from '@nestjs/common'
import type { Credential, CredentialVersion } from '../generated/prisma/client.js'
import { Prisma } from '../generated/prisma/client.js'
import { uuidv7 } from 'uuidv7'
import { AppError } from '@ledger-hq/domain'
import type { CreateCredentialInput, RotateCredentialInput } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ClientsService } from '../clients/clients.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { AuthService } from '../auth/auth.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PlatformsService } from './platforms.service.js'

export type CredentialWithVersions = Credential & { versions: CredentialVersion[] }

const LATEST_VERSION = { versions: { orderBy: { createdAt: 'desc' as const }, take: 1 } }

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly platforms: PlatformsService,
    private readonly auth: AuthService,
  ) {}

  async create(input: CreateCredentialInput): Promise<CredentialWithVersions> {
    await this.auth.assertVaultSetUp()
    await this.clients.findOne(input.clientId)
    await this.platforms.findOne(input.platformId)

    try {
      return await this.prisma.credential.create({
        data: {
          id: uuidv7(),
          clientId: input.clientId,
          platformId: input.platformId,
          label: input.label,
          versions: {
            create: {
              id: uuidv7(),
              ciphertext: Buffer.from(input.ciphertext, 'base64'),
              iv: Buffer.from(input.iv, 'base64'),
            },
          },
        },
        include: LATEST_VERSION,
      })
    } catch (error) {
      throw toLabelConflictOr(error, input.label)
    }
  }

  async rotate(id: string, input: RotateCredentialInput): Promise<CredentialWithVersions> {
    await this.findOne(id)

    // `updatedAt` is set explicitly rather than relied on implicitly: the
    // only scalar field on `Credential` in this write is the timestamp
    // itself, so an unambiguous, explicit value is clearer than depending on
    // Prisma's `@updatedAt` auto-touch behaviour for a nested-only write.
    return this.prisma.credential.update({
      where: { id },
      data: {
        updatedAt: new Date(),
        versions: {
          create: {
            id: uuidv7(),
            ciphertext: Buffer.from(input.ciphertext, 'base64'),
            iv: Buffer.from(input.iv, 'base64'),
          },
        },
      },
      include: LATEST_VERSION,
    })
  }

  async findOne(id: string): Promise<CredentialWithVersions> {
    const credential = await this.prisma.credential.findUnique({ where: { id }, include: LATEST_VERSION })
    if (!credential) throw new AppError('common.not_found', {}, 404)
    return credential
  }

  async listForClient(clientId: string): Promise<CredentialWithVersions[]> {
    await this.clients.findOne(clientId)
    return this.prisma.credential.findMany({ where: { clientId }, include: LATEST_VERSION, orderBy: { label: 'asc' } })
  }

  async listVersions(id: string): Promise<CredentialVersion[]> {
    await this.findOne(id)
    return this.prisma.credentialVersion.findMany({ where: { credentialId: id }, orderBy: { createdAt: 'desc' } })
  }

  sync(since: Date | null): Promise<CredentialWithVersions[]> {
    return this.prisma.credential.findMany({
      where: since ? { updatedAt: { gt: since } } : {},
      include: LATEST_VERSION,
      orderBy: { updatedAt: 'asc' },
    })
  }
}

/**
 * `Credential` carries exactly one unique constraint (`[clientId, platformId,
 * label]`), unlike `Client.taxId`, which shares its table with no other
 * unique column — so, unlike `clients.service.ts`'s `targetsTaxId`, no
 * target-column check is needed to know which constraint fired.
 */
function toLabelConflictOr(error: unknown, label: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new AppError('credentials.label_taken', { label }, 409)
  }
  return error
}
