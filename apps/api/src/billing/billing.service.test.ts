import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../common/prisma.service.js'
import type { ClientsService } from '../clients/clients.service.js'
import { BillingService } from './billing.service.js'

function fakePrisma(overrides: Record<string, unknown> = {}): PrismaService {
  return {
    client: { findMany: vi.fn().mockResolvedValue([]) },
    retainerPlan: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve(data)),
      update: vi.fn().mockResolvedValue({}),
    },
    charge: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(overrides)),
    ...overrides,
  } as unknown as PrismaService
}

function fakeClientsService(client: unknown): ClientsService {
  return { findOne: vi.fn().mockResolvedValue(client) } as unknown as ClientsService
}

const client = { id: 'c1', kind: 'COMPANY', archivedAt: null }

describe('BillingService#generateCharges', () => {
  it('generates one charge per elapsed period for an in-force plan', async () => {
    const plan = { id: 'plan-1', clientId: 'c1', amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: null }
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      retainerPlan: { findMany: vi.fn().mockResolvedValue([plan]) },
      charge: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
    })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.generateCharges({ asOf: new Date('2026-03-18T00:00:00Z') }, true)

    expect(result.toCreate).toEqual([
      { clientId: 'c1', planId: 'plan-1', periodLabel: '2026-01', amountCents: 9000, dueOn: '2026-01-08' },
      { clientId: 'c1', planId: 'plan-1', periodLabel: '2026-02', amountCents: 9000, dueOn: '2026-02-08' },
      { clientId: 'c1', planId: 'plan-1', periodLabel: '2026-03', amountCents: 9000, dueOn: '2026-03-08' },
    ])
  })

  it('is idempotent: skips a period that already has a charge', async () => {
    const plan = { id: 'plan-1', clientId: 'c1', amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: null }
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      retainerPlan: { findMany: vi.fn().mockResolvedValue([plan]) },
      charge: {
        findMany: vi.fn().mockResolvedValue([{ id: 'existing', clientId: 'c1', planId: 'plan-1', periodLabel: '2026-01' }]),
        create: vi.fn().mockResolvedValue({}),
      },
    })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.generateCharges({ asOf: new Date('2026-02-01T00:00:00Z') }, true)

    expect(result.toCreate).toEqual([
      { clientId: 'c1', planId: 'plan-1', periodLabel: '2026-02', amountCents: 9000, dueOn: '2026-02-08' },
    ])
  })

  it('generates nothing for a client with no in-force plan', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      retainerPlan: { findMany: vi.fn().mockResolvedValue([]) },
    })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.generateCharges({ asOf: new Date('2026-03-18T00:00:00Z') }, true)

    expect(result.toCreate).toEqual([])
  })

  it('dry run never calls charge.create', async () => {
    const plan = { id: 'plan-1', clientId: 'c1', amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: null }
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      retainerPlan: { findMany: vi.fn().mockResolvedValue([plan]) },
    })
    const service = new BillingService(prisma, fakeClientsService(client))

    await service.generateCharges({ asOf: new Date('2026-03-18T00:00:00Z') }, true)

    expect(prisma.charge.create).not.toHaveBeenCalled()
  })

  it('apply (dryRun=false) calls charge.create for every proposed charge', async () => {
    const plan = { id: 'plan-1', clientId: 'c1', amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: null }
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      retainerPlan: { findMany: vi.fn().mockResolvedValue([plan]) },
      charge: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
    })
    const service = new BillingService(prisma, fakeClientsService(client))

    await service.generateCharges({ asOf: new Date('2026-03-18T00:00:00Z') }, false)

    expect(prisma.charge.create).toHaveBeenCalledTimes(3)
  })
})

describe('BillingService#createRetainerPlan', () => {
  it('creates the client\'s first plan', async () => {
    const prisma = fakePrisma()
    const service = new BillingService(prisma, fakeClientsService(client))

    const created = await service.createRetainerPlan('c1', {
      amountCents: 9000,
      periodicity: 'MONTHLY',
      dueDayOfMonth: 8,
      validFrom: '2026-01-01',
    })

    expect(created).toMatchObject({ clientId: 'c1', amountCents: 9000, validTo: null })
  })

  it('rejects a second plan while one is already in force', async () => {
    const prisma = fakePrisma({
      retainerPlan: { findFirst: vi.fn().mockResolvedValue({ id: 'existing' }), create: vi.fn() },
    })
    const service = new BillingService(prisma, fakeClientsService(client))

    await expect(
      service.createRetainerPlan('c1', { amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-01-01' }),
    ).rejects.toThrow('billing.plan_overlap')
  })
})

describe('BillingService#renewRetainerPlan', () => {
  it('closes the current plan and creates a new one in one transaction', async () => {
    const currentPlan = { id: 'old', clientId: 'c1', amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: null }
    const tx = {
      retainerPlan: {
        findFirst: vi.fn().mockResolvedValue(currentPlan),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({ id: 'new' }),
      },
    }
    const prisma = fakePrisma({ $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)) })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.renewRetainerPlan('c1', { newAmountCents: 12000, effectiveFrom: '2026-06-01' })

    expect(result).toEqual({ closedPlanId: 'old', newPlanId: 'new' })
    expect(tx.retainerPlan.update).toHaveBeenCalledWith({
      where: { id: 'old' },
      data: { validTo: new Date('2026-05-31T00:00:00Z') },
    })
    expect(tx.retainerPlan.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ clientId: 'c1', amountCents: 12000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validTo: null }),
    })
  })

  it('creates a plan directly, with no closedPlanId, when the client has no current plan', async () => {
    const tx = {
      retainerPlan: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'new' }),
      },
    }
    const prisma = fakePrisma({ $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)) })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.renewRetainerPlan('c1', { newAmountCents: 9000, effectiveFrom: '2026-01-01', periodicity: 'MONTHLY', dueDayOfMonth: 8 })

    expect(result).toEqual({ closedPlanId: null, newPlanId: 'new' })
    expect(tx.retainerPlan.update).not.toHaveBeenCalled()
  })

  it('rejects a renewal whose effectiveFrom would leave the closed plan with a negative-length range', async () => {
    const currentPlan = { id: 'old', clientId: 'c1', amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-06-01T00:00:00Z'), validTo: null }
    const tx = { retainerPlan: { findFirst: vi.fn().mockResolvedValue(currentPlan), update: vi.fn(), create: vi.fn() } }
    const prisma = fakePrisma({ $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)) })
    const service = new BillingService(prisma, fakeClientsService(client))

    // effectiveFrom before the current plan even started.
    await expect(
      service.renewRetainerPlan('c1', { newAmountCents: 12000, effectiveFrom: '2026-01-01' }),
    ).rejects.toThrow('billing.plan_overlap')
  })
})
