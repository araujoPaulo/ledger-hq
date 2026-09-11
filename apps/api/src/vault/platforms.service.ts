import { Injectable } from '@nestjs/common'
import type { Platform } from '../generated/prisma/client.js'
import { Prisma } from '../generated/prisma/client.js'
import { uuidv7 } from 'uuidv7'
import { AppError } from '@ledger-hq/domain'
import type { CreatePlatformInput, UpdatePlatformInput } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'

@Injectable()
export class PlatformsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreatePlatformInput): Promise<Platform> {
    try {
      return await this.prisma.platform.create({
        data: { id: uuidv7(), name: input.name, url: input.url ?? null, authKind: input.authKind },
      })
    } catch (error) {
      throw toNameConflictOr(error, input.name)
    }
  }

  list(): Promise<Platform[]> {
    return this.prisma.platform.findMany({ orderBy: { name: 'asc' } })
  }

  async findOne(id: string): Promise<Platform> {
    const platform = await this.prisma.platform.findUnique({ where: { id } })
    if (!platform) throw new AppError('common.not_found', {}, 404)
    return platform
  }

  async update(id: string, input: UpdatePlatformInput): Promise<Platform> {
    await this.findOne(id)

    try {
      const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
      return await this.prisma.platform.update({ where: { id }, data })
    } catch (error) {
      throw toNameConflictOr(error, input.name ?? '')
    }
  }
}

/**
 * Same check-then-act-plus-catch shape as `clients.service.ts`'s
 * `toTaxIdConflictOr`: the friendly path (no check here, since none was
 * needed before this task) is really just this catch, turning the
 * database's own unique-constraint violation into the specific domain
 * error instead of an opaque 500.
 */
function toNameConflictOr(error: unknown, name: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && targetsName(error.meta)) {
    return new AppError('platforms.name_taken', { name }, 409)
  }
  return error
}

function targetsName(meta: Record<string, unknown> | undefined): boolean {
  const target = meta?.target
  if (Array.isArray(target)) return target.includes('name')
  return typeof target === 'string' && target.includes('name')
}
