import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from 'uuidv7'
import { getTestPrisma, resetDatabase } from './database.js'
import { BillingService } from '../src/billing/billing.service.js'
import { ClientsService } from '../src/clients/clients.service.js'
import type { PrismaService } from '../src/common/prisma.service.js'

const prisma = getTestPrisma()
// getTestPrisma() returns the plain generated PrismaClient; the services are typed against
// PrismaService (which adds NestJS lifecycle hooks the tests never invoke), so bridge here —
// same convention as the `as unknown as PrismaService` cast in billing.service.test.ts's fakePrisma().
const prismaService = prisma as unknown as PrismaService
const billing = new BillingService(prismaService, new ClientsService(prismaService))

async function createClient(taxId: string, name = 'Test Client'): Promise<string> {
  const client = await prisma.client.create({
    data: { id: uuidv7(), kind: 'COMPANY', name, taxId, accounting: 'ORGANIZED', legalForm: 'LDA' },
  })
  return client.id
}

beforeEach(async () => {
  await resetDatabase()
})

describe('BillingService#getReceivables', () => {
  it('buckets outstanding balances by ageing, worst first', async () => {
    const clientId = await createClient('600000001', 'Old Debt Lda')
    await prisma.charge.create({
      data: {
        id: uuidv7(), clientId, kind: 'EXTRA', description: 'Old', amountCents: 10000,
        issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-01T00:00:00Z'),
      },
    })

    const rows = await billing.getReceivables(new Date('2026-04-01T00:00:00Z'))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ clientId, clientName: 'Old Debt Lda', outstandingCents: 10000, ageingBucket: '61-90' })
  })

  it('excludes a fully settled charge', async () => {
    const clientId = await createClient('600000002')
    const charge = await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'Paid', amountCents: 5000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-01T00:00:00Z') },
    })
    const payment = await prisma.payment.create({ data: { id: uuidv7(), clientId, amountCents: 5000, receivedOn: new Date('2026-01-05T00:00:00Z'), method: 'TRANSFER' } })
    await prisma.paymentAllocation.create({ data: { paymentId: payment.id, chargeId: charge.id, amountCents: 5000 } })

    const rows = await billing.getReceivables(new Date('2026-04-01T00:00:00Z'))

    expect(rows).toEqual([])
  })

  it('excludes a written-off charge', async () => {
    const clientId = await createClient('600000003')
    await prisma.charge.create({
      data: {
        id: uuidv7(), clientId, kind: 'EXTRA', description: 'Written off', amountCents: 5000,
        issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-01T00:00:00Z'),
        writtenOffAt: new Date('2026-02-01T00:00:00Z'), writeOffReason: 'Insolvent',
      },
    })

    const rows = await billing.getReceivables(new Date('2026-04-01T00:00:00Z'))

    expect(rows).toEqual([])
  })

  it('returns plain numbers, never bigint, for the aggregated cents columns', async () => {
    const clientId = await createClient('600000004')
    await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'X', amountCents: 5000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-01T00:00:00Z') },
    })

    const rows = await billing.getReceivables(new Date('2026-01-15T00:00:00Z'))

    expect(typeof rows[0]!.outstandingCents).toBe('number')
  })
})

describe('BillingService#getCurrentMonth', () => {
  it('reports a client as unpaid when this month\'s retainer charge is still open', async () => {
    const clientId = await createClient('600000005')
    const plan = await prisma.retainerPlan.create({
      data: { id: uuidv7(), clientId, amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z') },
    })
    await prisma.charge.create({
      data: { id: uuidv7(), clientId, planId: plan.id, kind: 'RETAINER', description: 'March', periodLabel: '2026-03', amountCents: 9000, issuedOn: new Date('2026-03-01T00:00:00Z'), dueOn: new Date('2026-03-08T00:00:00Z') },
    })

    const rows = await billing.getCurrentMonth(new Date('2026-03-18T00:00:00Z'))

    expect(rows).toContainEqual(expect.objectContaining({ clientId, paid: false, outstandingCents: 9000 }))
  })

  it('reports a client as paid once this month\'s charge is fully allocated', async () => {
    const clientId = await createClient('600000006')
    const plan = await prisma.retainerPlan.create({
      data: { id: uuidv7(), clientId, amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z') },
    })
    const charge = await prisma.charge.create({
      data: { id: uuidv7(), clientId, planId: plan.id, kind: 'RETAINER', description: 'March', periodLabel: '2026-03', amountCents: 9000, issuedOn: new Date('2026-03-01T00:00:00Z'), dueOn: new Date('2026-03-08T00:00:00Z') },
    })
    const payment = await prisma.payment.create({ data: { id: uuidv7(), clientId, amountCents: 9000, receivedOn: new Date('2026-03-05T00:00:00Z'), method: 'TRANSFER' } })
    await prisma.paymentAllocation.create({ data: { paymentId: payment.id, chargeId: charge.id, amountCents: 9000 } })

    const rows = await billing.getCurrentMonth(new Date('2026-03-18T00:00:00Z'))

    expect(rows).toContainEqual(expect.objectContaining({ clientId, paid: true, outstandingCents: 0 }))
  })
})

describe('BillingService#getClientLedger', () => {
  it('lists charges and payments chronologically with a running balance', async () => {
    const clientId = await createClient('600000007')
    const charge = await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'Consultoria', amountCents: 10000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-15T00:00:00Z') },
    })
    const payment = await prisma.payment.create({ data: { id: uuidv7(), clientId, amountCents: 4000, receivedOn: new Date('2026-01-10T00:00:00Z'), method: 'TRANSFER' } })
    await prisma.paymentAllocation.create({ data: { paymentId: payment.id, chargeId: charge.id, amountCents: 4000 } })

    const ledger = await billing.getClientLedger(clientId)

    expect(ledger.entries).toEqual([
      expect.objectContaining({ type: 'CHARGE', amountCents: 10000, runningBalanceCents: 10000 }),
      expect.objectContaining({ type: 'PAYMENT', amountCents: -4000, runningBalanceCents: 6000 }),
    ])
    expect(ledger.balanceCents).toBe(6000)
  })

  it('returns a zero balance and empty entries for a client with no billing history', async () => {
    const clientId = await createClient('600000008')

    const ledger = await billing.getClientLedger(clientId)

    expect(ledger).toEqual({ entries: [], balanceCents: 0 })
  })
})
