import { Injectable } from '@nestjs/common'
import type { Client, Prisma } from '../generated/prisma/client.js'
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

    return this.prisma.client.create({
      data: { id: uuidv7(), ...toPersistedFields(input) } as Prisma.ClientUncheckedCreateInput,
    })
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

    const { kind: _kind, ...changes } = input
    if (typeof changes.taxId === 'string' && changes.taxId !== existing.taxId) {
      await this.assertTaxIdFree(changes.taxId)
    }

    return this.prisma.client.update({ where: { id }, data: toPersistedFields(changes) })
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
