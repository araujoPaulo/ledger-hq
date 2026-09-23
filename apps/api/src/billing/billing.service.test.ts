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
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    payment: {
      create: vi.fn().mockResolvedValue({}),
    },
    paymentAllocation: {
      create: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
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

describe('BillingService#proposeAllocationForClient', () => {
  it('reads open charges from charge_balances and proposes FIFO', async () => {
    const openCharges = [
      { id: 'a', clientId: 'c1', kind: 'RETAINER', periodLabel: '2026-01', dueOn: new Date('2026-01-08T00:00:00Z'), amountCents: 9000, allocatedCents: 0, outstandingCents: 9000, status: 'OPEN', description: 'Retainer — 2026-01' },
    ]
    const prisma = fakePrisma({ $queryRaw: vi.fn().mockResolvedValue(openCharges) })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.proposeAllocationForClient('c1', 9000)

    expect(result).toEqual({
      proposed: [{ chargeId: 'a', amountCents: 9000, description: 'Retainer — 2026-01', periodLabel: '2026-01', dueOn: '2026-01-08' }],
      excessCents: 0,
    })
  })

  it('reports the unallocated remainder as excess', async () => {
    const openCharges = [
      { id: 'a', clientId: 'c1', kind: 'RETAINER', periodLabel: '2026-01', dueOn: new Date('2026-01-08T00:00:00Z'), amountCents: 9000, allocatedCents: 0, outstandingCents: 9000, status: 'OPEN', description: 'Retainer — 2026-01' },
    ]
    const prisma = fakePrisma({ $queryRaw: vi.fn().mockResolvedValue(openCharges) })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.proposeAllocationForClient('c1', 15000)

    expect(result).toEqual({
      proposed: [{ chargeId: 'a', amountCents: 9000, description: 'Retainer — 2026-01', periodLabel: '2026-01', dueOn: '2026-01-08' }],
      excessCents: 6000,
    })
  })
})

describe('BillingService#recordPayment', () => {
  it('creates the payment and every requested allocation in one transaction', async () => {
    const tx = {
      payment: { create: vi.fn().mockResolvedValue({}) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'a', outstandingCents: 9000 }]),
      paymentAllocation: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = fakePrisma({ $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)) })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.recordPayment({
      clientId: 'c1',
      amountCents: 9000,
      receivedOn: '2026-09-03',
      method: 'TRANSFER',
      allocations: [{ chargeId: 'a', amountCents: 9000 }],
    })

    expect(result.paymentId).toEqual(expect.any(String))
    expect(tx.paymentAllocation.create).toHaveBeenCalledTimes(1)
  })

  it('rejects allocations that sum to more than the payment', async () => {
    const prisma = fakePrisma({ $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn({})) })
    const service = new BillingService(prisma, fakeClientsService(client))

    await expect(
      service.recordPayment({
        clientId: 'c1',
        amountCents: 5000,
        receivedOn: '2026-09-03',
        method: 'TRANSFER',
        allocations: [{ chargeId: 'a', amountCents: 9000 }],
      }),
    ).rejects.toThrow('billing.allocation_exceeds_payment')
  })

  it('rejects an allocation that exceeds its own charge\'s outstanding balance', async () => {
    const tx = {
      payment: { create: vi.fn().mockResolvedValue({}) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'a', outstandingCents: 3000 }]),
      paymentAllocation: { create: vi.fn() },
    }
    const prisma = fakePrisma({ $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)) })
    const service = new BillingService(prisma, fakeClientsService(client))

    await expect(
      service.recordPayment({
        clientId: 'c1',
        amountCents: 9000,
        receivedOn: '2026-09-03',
        method: 'TRANSFER',
        allocations: [{ chargeId: 'a', amountCents: 9000 }],
      }),
    ).rejects.toThrow('billing.allocation_exceeds_charge_balance')
  })

  it('accepts an empty allocations array — a payment recorded as pure credit', async () => {
    const tx = { payment: { create: vi.fn().mockResolvedValue({}) }, $queryRaw: vi.fn(), paymentAllocation: { create: vi.fn() } }
    const prisma = fakePrisma({ $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)) })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.recordPayment({ clientId: 'c1', amountCents: 9000, receivedOn: '2026-09-03', method: 'TRANSFER', allocations: [] })

    expect(result.paymentId).toEqual(expect.any(String))
    expect(tx.paymentAllocation.create).not.toHaveBeenCalled()
  })
})

describe('BillingService#createAdHocCharge', () => {
  it('creates an EXTRA charge with no plan', async () => {
    const prisma = fakePrisma({ charge: { create: vi.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve(data)) } })
    const service = new BillingService(prisma, fakeClientsService(client))

    const created = await service.createAdHocCharge({ clientId: 'c1', description: 'Consultoria extra', amountCents: 15000, dueOn: '2026-10-01' })

    expect(created).toMatchObject({ clientId: 'c1', kind: 'EXTRA', planId: null, periodLabel: null, amountCents: 15000 })
  })
})

describe('BillingService#writeOffCharge', () => {
  it('sets writtenOffAt and the reason', async () => {
    const prisma = fakePrisma({
      charge: {
        findUnique: vi.fn().mockResolvedValue({ id: 'a', writtenOffAt: null }),
        update: vi.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'a', ...(data as object) })),
      },
    })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.writeOffCharge('a', 'Cliente insolvente')

    expect(result).toMatchObject({ writeOffReason: 'Cliente insolvente', writtenOffAt: expect.any(Date) })
  })

  it('refuses to write off a charge that is already written off', async () => {
    const prisma = fakePrisma({
      charge: { findUnique: vi.fn().mockResolvedValue({ id: 'a', writtenOffAt: new Date('2026-02-01T00:00:00Z'), writeOffReason: 'Insolvente' }) },
    })
    const service = new BillingService(prisma, fakeClientsService(client))

    await expect(service.writeOffCharge('a', 'outro motivo')).rejects.toThrow('billing.charge_already_written_off')
  })

  it('404s on an unknown charge', async () => {
    const prisma = fakePrisma({ charge: { findUnique: vi.fn().mockResolvedValue(null) } })
    const service = new BillingService(prisma, fakeClientsService(client))

    await expect(service.writeOffCharge('missing', 'reason')).rejects.toThrow('common.not_found')
  })
})
