import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../common/prisma.service.js'
import { Prisma } from '../generated/prisma/client.js'
import { ClientsService } from './clients.service.js'

const company = {
  kind: 'COMPANY',
  name: 'Padaria Central, Lda.',
  taxId: '501442600',
  accounting: 'ORGANIZED',
  legalForm: 'LDA',
} as const

/** What Postgres actually reports when the `taxId` unique index is hit. */
function taxIdConflict(): InstanceType<typeof Prisma.PrismaClientKnownRequestError> {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`taxId`)', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['taxId'] },
  })
}

function fakePrisma(overrides: {
  findUnique?: ReturnType<typeof vi.fn>
  create?: ReturnType<typeof vi.fn>
  update?: ReturnType<typeof vi.fn>
}): PrismaService {
  return {
    client: {
      findUnique: overrides.findUnique ?? vi.fn().mockResolvedValue(null),
      create: overrides.create ?? vi.fn(),
      update: overrides.update ?? vi.fn(),
    },
  } as unknown as PrismaService
}

/**
 * `assertTaxIdFree`'s check-then-act read only guards the common path: two
 * concurrent creates (or an update racing a create) can both pass it before
 * either commits, so the database's own unique index is the guarantee that
 * actually holds. These tests bypass the pre-check entirely (it resolves
 * "free" every time) and assert on what happens when the write itself hits
 * the constraint — the case a real race produces.
 */
describe('ClientsService — the tax-id unique-constraint race', () => {
  it('create() turns a P2002 on taxId into clients.tax_id_taken, not a raw 500', async () => {
    const service = new ClientsService(fakePrisma({ create: vi.fn().mockRejectedValue(taxIdConflict()) }))

    await expect(service.create(company)).rejects.toMatchObject({
      code: 'clients.tax_id_taken',
      params: { taxId: '501442600' },
      status: 409,
    })
  })

  it('update() turns a P2002 on taxId into clients.tax_id_taken, not a raw 500', async () => {
    const existing = { id: 'c1', kind: 'COMPANY', taxId: '000000000', archivedAt: null }
    const service = new ClientsService(
      fakePrisma({
        // First call is `findOne` inside `update`; second is `assertTaxIdFree`'s own pre-check.
        findUnique: vi.fn().mockResolvedValueOnce(existing).mockResolvedValueOnce(null),
        update: vi.fn().mockRejectedValue(taxIdConflict()),
      }),
    )

    await expect(service.update('c1', { kind: 'COMPANY', taxId: '501442600' })).rejects.toMatchObject({
      code: 'clients.tax_id_taken',
      params: { taxId: '501442600' },
      status: 409,
    })
  })

  it('rethrows an unrelated database error unchanged', async () => {
    const boom = new Error('connection reset')
    const service = new ClientsService(fakePrisma({ create: vi.fn().mockRejectedValue(boom) }))

    await expect(service.create(company)).rejects.toBe(boom)
  })

  it('rethrows a P2002 on a different column unchanged', async () => {
    const otherConflict = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`id`)', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['id'] },
    })
    const service = new ClientsService(fakePrisma({ create: vi.fn().mockRejectedValue(otherConflict) }))

    await expect(service.create(company)).rejects.toBe(otherConflict)
  })
})
