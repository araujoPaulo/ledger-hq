import { Injectable } from '@nestjs/common'
import type { Client } from '../generated/prisma/client.js'
import { Prisma } from '../generated/prisma/client.js'
import { uuidv7 } from 'uuidv7'
import { AppError } from '@ledger-hq/domain'
import type { CreateClientInput, UpdateClientInput } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'

export type ListFilters = {
  kind?: Client['kind']
  search?: string
  includeArchived?: boolean
}

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateClientInput): Promise<Client> {
    await this.assertTaxIdFree(input.taxId)

    try {
      return await this.prisma.client.create({
        data: { id: uuidv7(), ...toPersistedFields(input) } as Prisma.ClientUncheckedCreateInput,
      })
    } catch (error) {
      throw toTaxIdConflictOr(error, input.taxId)
    }
  }

  async list(filters: ListFilters): Promise<Client[]> {
    const search = filters.search?.trim()

    return this.prisma.client.findMany({
      where: {
        ...(filters.kind ? { kind: filters.kind } : {}),
        ...(filters.includeArchived ? {} : { archivedAt: null }),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { taxId: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    })
  }

  async findOne(id: string): Promise<Client> {
    const client = await this.prisma.client.findUnique({ where: { id } })
    if (!client) throw new AppError('common.not_found', {}, 404)

    return client
  }

  async update(id: string, input: UpdateClientInput): Promise<Client> {
    const existing = await this.findOne(id)
    if (existing.archivedAt) throw new AppError('clients.archived', {}, 409)
    // The kind CHECK constraint (`client_kind_fields`) would catch a mismatch
    // at the database, but only as an opaque constraint-violation error; this
    // gives the caller a clean, specific one instead.
    if (input.kind !== existing.kind) throw new AppError('clients.kind_mismatch', {}, 409)

    const { kind: _kind, ...changes } = input
    if (typeof changes.taxId === 'string' && changes.taxId !== existing.taxId) {
      await this.assertTaxIdFree(changes.taxId)
    }

    try {
      return await this.prisma.client.update({ where: { id }, data: toPersistedFields(changes) })
    } catch (error) {
      const taxId = typeof changes.taxId === 'string' ? changes.taxId : existing.taxId
      throw toTaxIdConflictOr(error, taxId)
    }
  }

  async archive(id: string): Promise<Client> {
    await this.findOne(id)
    return this.prisma.client.update({ where: { id }, data: { archivedAt: new Date() } })
  }

  async restore(id: string): Promise<Client> {
    await this.findOne(id)
    return this.prisma.client.update({ where: { id }, data: { archivedAt: null } })
  }

  private async assertTaxIdFree(taxId: string): Promise<void> {
    const clash = await this.prisma.client.findUnique({ where: { taxId } })
    if (clash) throw new AppError('clients.tax_id_taken', { taxId }, 409)
  }
}

/** Converts the wire shape's date strings into the `Date` values Prisma wants. */
function toPersistedFields(input: Record<string, unknown>): Record<string, unknown> {
  const fields = { ...input }
  delete fields.kind

  if (typeof fields.dateOfBirth === 'string') {
    fields.dateOfBirth = new Date(`${fields.dateOfBirth}T00:00:00Z`)
  }

  return 'kind' in input ? { ...fields, kind: input.kind } : fields
}

/**
 * `assertTaxIdFree`'s check-then-act read is only the friendly path: two
 * concurrent writes can both pass it before either commits. This closes the
 * gap by turning the database's own unique-constraint violation — the
 * guarantee that actually holds — into the same domain error, instead of
 * letting it fall through to the catch-all filter as an opaque 500.
 */
function toTaxIdConflictOr(error: unknown, taxId: string): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    targetsTaxId(error.meta)
  ) {
    return new AppError('clients.tax_id_taken', { taxId }, 409)
  }

  return error
}

function targetsTaxId(meta: Record<string, unknown> | undefined): boolean {
  const target = meta?.target
  if (Array.isArray(target)) return target.includes('taxId')
  return typeof target === 'string' && target.includes('taxId')
}
