import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from 'uuidv7'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { getTestPrisma, resetDatabase } from './database.js'
import { createTestApp } from './app.js'
import { authenticate } from './authenticate.js'
import { BillingService } from '../src/billing/billing.service.js'
import { ClientsService } from '../src/clients/clients.service.js'
import type { PrismaService } from '../src/common/prisma.service.js'

const prisma = getTestPrisma()
// getTestPrisma() returns the plain generated PrismaClient; the services are typed against
// PrismaService (which adds NestJS lifecycle hooks the tests never invoke), so bridge here —
// same convention as the `as unknown as PrismaService` cast in billing.service.test.ts's fakePrisma().
const prismaService = prisma as unknown as PrismaService
const billing = new BillingService(prismaService, new ClientsService(prismaService))

let app: INestApplication
let cookie: string[]

async function createClient(taxId: string, name = 'Test Client'): Promise<string> {
  const client = await prisma.client.create({
    data: { id: uuidv7(), kind: 'COMPANY', name, taxId, accounting: 'ORGANIZED', legalForm: 'LDA' },
  })
  return client.id
}

function post(path: string, body: Record<string, unknown> = {}) {
  return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq').send(body)
}

function patch(path: string, body: Record<string, unknown>) {
  return request(app.getHttpServer()).patch(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq').send(body)
}

function get(path: string) {
  return request(app.getHttpServer()).get(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq')
}

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
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

describe('BillingController', () => {
  it('generate-charges defaults to a dry run when the query param is omitted', async () => {
    const clientId = await createClient('600000009')
    await prisma.retainerPlan.create({
      data: { id: uuidv7(), clientId, amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z') },
    })

    const response = await post('/api/v1/billing/generate-charges', { asOf: '2026-01-15' })

    expect(response.status).toBe(201)
    expect(response.body.toCreate.length).toBeGreaterThan(0)
    const charges = await prisma.charge.findMany({ where: { clientId } })
    expect(charges).toHaveLength(0)
  })

  it('generate-charges applies when dryRun=false', async () => {
    const clientId = await createClient('600000010')
    await prisma.retainerPlan.create({
      data: { id: uuidv7(), clientId, amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z') },
    })

    await post('/api/v1/billing/generate-charges?dryRun=false', { asOf: '2026-01-15' })

    const charges = await prisma.charge.findMany({ where: { clientId } })
    expect(charges).toHaveLength(1)
  })

  it('creates a first retainer plan for a client', async () => {
    const clientId = await createClient('600000011')

    const response = await post(`/api/v1/billing/clients/${clientId}/retainer-plan`, {
      amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-01-01',
    })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ clientId, amountCents: 9000 })
  })

  it('rejects a second plan for a client that already has one in force', async () => {
    const clientId = await createClient('600000012')
    await post(`/api/v1/billing/clients/${clientId}/retainer-plan`, { amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-01-01' })

    const response = await post(`/api/v1/billing/clients/${clientId}/retainer-plan`, { amountCents: 12000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-02-01' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('billing.plan_overlap')
  })

  it('renews a retainer plan, closing the old one and creating a new one', async () => {
    const clientId = await createClient('600000013')
    await post(`/api/v1/billing/clients/${clientId}/retainer-plan`, { amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-01-01' })

    const response = await post(`/api/v1/billing/clients/${clientId}/retainer-plan/renew`, { newAmountCents: 12000, effectiveFrom: '2026-06-01' })

    expect(response.status).toBe(201)
    expect(response.body.newPlanId).toEqual(expect.any(String))
    const plans = await prisma.retainerPlan.findMany({ where: { clientId }, orderBy: { validFrom: 'asc' } })
    expect(plans).toHaveLength(2)
    expect(plans[0]!.validTo).toEqual(new Date('2026-05-31T00:00:00.000Z'))
  })

  it('proposes and then records a payment with allocations', async () => {
    const clientId = await createClient('600000014')
    const charge = await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'X', amountCents: 9000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-08T00:00:00Z') },
    })

    const proposal = await post('/api/v1/billing/payments/propose-allocation', { clientId, amountCents: 9000 })
    expect(proposal.body.proposed).toEqual([{ chargeId: charge.id, amountCents: 9000 }])

    const payment = await post('/api/v1/billing/payments', {
      clientId, amountCents: 9000, receivedOn: '2026-01-10', method: 'TRANSFER', allocations: proposal.body.proposed,
    })
    expect(payment.status).toBe(201)
  })

  it('creates an ad-hoc charge', async () => {
    const clientId = await createClient('600000015')

    const response = await post('/api/v1/billing/charges', { clientId, description: 'Extra', amountCents: 5000, dueOn: '2026-10-01' })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ clientId, kind: 'EXTRA' })
  })

  it('writes off a charge with a reason', async () => {
    const clientId = await createClient('600000016')
    const charge = await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'X', amountCents: 5000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-08T00:00:00Z') },
    })

    const response = await patch(`/api/v1/billing/charges/${charge.id}/write-off`, { reason: 'Cliente insolvente' })

    expect(response.status).toBe(200)
    expect(response.body.writeOffReason).toBe('Cliente insolvente')
  })

  it('422s a write-off with an empty reason', async () => {
    const clientId = await createClient('600000017')
    const charge = await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'X', amountCents: 5000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-08T00:00:00Z') },
    })

    const response = await patch(`/api/v1/billing/charges/${charge.id}/write-off`, { reason: '' })

    expect(response.status).toBe(422)
  })

  it('lists receivables', async () => {
    const clientId = await createClient('600000018')
    await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'X', amountCents: 5000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-08T00:00:00Z') },
    })

    const response = await get('/api/v1/billing/receivables')

    expect(response.status).toBe(200)
    expect(response.body).toContainEqual(expect.objectContaining({ clientId, outstandingCents: 5000 }))
  })

  it('lists the current month\'s retainer status', async () => {
    const response = await get('/api/v1/billing/current-month')
    expect(response.status).toBe(200)
    expect(Array.isArray(response.body)).toBe(true)
  })

  it('returns a client\'s ledger', async () => {
    const clientId = await createClient('600000019')

    const response = await get(`/api/v1/billing/clients/${clientId}/ledger`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ entries: [], balanceCents: 0 })
  })
})
