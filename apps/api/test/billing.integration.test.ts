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

    expect(ledger).toEqual({ entries: [], balanceCents: 0, availableCreditCents: 0 })
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
    // The proposal row carries the charge's description/period/due date for
    // the operator to check; only the allocation half goes back on the wire.
    // `paymentId` is null here because the proposal is allocated against the
    // payment being recorded now, which has no id yet (billing.service.ts's
    // `proposeAllocationForClient` sources the allocator with `paymentId: null`).
    expect(proposal.body.proposed).toEqual([
      { paymentId: null, chargeId: charge.id, amountCents: 9000, description: 'X', periodLabel: null, dueOn: '2026-01-08' },
    ])

    const payment = await post('/api/v1/billing/payments', {
      clientId, amountCents: 9000, receivedOn: '2026-01-10', method: 'TRANSFER',
      allocations: proposal.body.proposed.map((row: { chargeId: string; amountCents: number }) => ({ chargeId: row.chargeId, amountCents: row.amountCents })),
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
    expect(response.body).toEqual({ entries: [], balanceCents: 0, availableCreditCents: 0 })
  })
})

describe('GET /billing/clients/:clientId/retainer-plan', () => {
  it('returns the in-force plan', async () => {
    const clientId = await createClient('600000020')
    await post(`/api/v1/billing/clients/${clientId}/retainer-plan`, { amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-01-01' })

    const response = await get(`/api/v1/billing/clients/${clientId}/retainer-plan`)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ clientId, amountCents: 9000 })
  })

  it('returns null for a client with no plan', async () => {
    const clientId = await createClient('600000021')

    const response = await get(`/api/v1/billing/clients/${clientId}/retainer-plan`)

    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
  })
})

// Regressions from the Phase 3 whole-branch review. Each one is a money
// defect that the phase's original tests missed because they only ever
// exercised a single open charge, a single plan, or a MONTHLY periodicity.
describe('billing regressions', () => {
  it('proposes an allocation across two open charges, oldest first', async () => {
    const clientId = await createClient('600000030')
    const february = await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'Fevereiro', amountCents: 9000, issuedOn: new Date('2026-02-01T00:00:00Z'), dueOn: new Date('2026-02-08T00:00:00Z') },
    })
    const january = await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'Janeiro', amountCents: 9000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-08T00:00:00Z') },
    })

    const response = await post('/api/v1/billing/payments/propose-allocation', { clientId, amountCents: 18000 })

    expect(response.status).toBe(201)
    expect(response.body.proposed).toMatchObject([
      { chargeId: january.id, amountCents: 9000, description: 'Janeiro' },
      { chargeId: february.id, amountCents: 9000, description: 'Fevereiro' },
    ])
  })

  it('never proposes, nor accepts, an allocation against a written-off charge', async () => {
    const clientId = await createClient('600000031')
    const writtenOff = await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'Incobrável', amountCents: 5000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-08T00:00:00Z'), writtenOffAt: new Date('2026-02-01T00:00:00Z'), writeOffReason: 'Insolvente' },
    })
    const live = await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'Março', amountCents: 9000, issuedOn: new Date('2026-03-01T00:00:00Z'), dueOn: new Date('2026-03-08T00:00:00Z') },
    })

    const proposal = await post('/api/v1/billing/payments/propose-allocation', { clientId, amountCents: 9000 })
    expect(proposal.body.proposed).toMatchObject([{ chargeId: live.id, amountCents: 9000 }])

    const payment = await post('/api/v1/billing/payments', {
      clientId, amountCents: 5000, receivedOn: '2026-03-10', method: 'TRANSFER',
      allocations: [{ chargeId: writtenOff.id, amountCents: 5000 }],
    })
    expect(payment.status).toBe(422)
    expect(payment.body.error.code).toBe('billing.allocation_exceeds_charge_balance')
  })

  it("refuses to allocate one client's payment to another client's charge", async () => {
    const payer = await createClient('600000032', 'Payer')
    const stranger = await createClient('600000033', 'Stranger')
    const strangerCharge = await prisma.charge.create({
      data: { id: uuidv7(), clientId: stranger, kind: 'EXTRA', description: 'Alheia', amountCents: 9000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-08T00:00:00Z') },
    })

    const response = await post('/api/v1/billing/payments', {
      clientId: payer, amountCents: 9000, receivedOn: '2026-01-10', method: 'TRANSFER',
      allocations: [{ chargeId: strangerCharge.id, amountCents: 9000 }],
    })

    expect(response.status).toBe(422)
    const allocations = await prisma.paymentAllocation.findMany({ where: { chargeId: strangerCharge.id } })
    expect(allocations).toHaveLength(0)
  })

  it('does not regenerate a period the previous plan already charged', async () => {
    const clientId = await createClient('600000034')
    const closed = await prisma.retainerPlan.create({
      data: { id: uuidv7(), clientId, amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: new Date('2026-02-28T00:00:00Z') },
    })
    // March was generated by the daily cron while the old plan was still in
    // force, before the operator raised the fee effective 1 March.
    await prisma.charge.create({
      data: { id: uuidv7(), clientId, planId: closed.id, kind: 'RETAINER', description: 'Retainer — 2026-03', periodLabel: '2026-03', amountCents: 9000, issuedOn: new Date('2026-03-01T00:00:00Z'), dueOn: new Date('2026-03-08T00:00:00Z') },
    })
    await prisma.retainerPlan.create({
      data: { id: uuidv7(), clientId, amountCents: 12000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-03-01T00:00:00Z'), validTo: null },
    })

    await billing.generateCharges({ asOf: new Date('2026-03-15T00:00:00Z'), clientId }, false)

    const march = await prisma.charge.findMany({ where: { clientId, periodLabel: '2026-03' } })
    expect(march).toHaveLength(1)
    expect(march[0]!.amountCents).toBe(9000)
  })

  it('reports a quarterly plan whose current-period charge is unpaid as unpaid', async () => {
    const clientId = await createClient('600000035', 'Quarterly Client')
    const asOf = new Date()
    const quarterLabel = `${asOf.getUTCFullYear()}-Q${Math.floor(asOf.getUTCMonth() / 3) + 1}`
    const plan = await prisma.retainerPlan.create({
      data: { id: uuidv7(), clientId, amountCents: 30000, periodicity: 'QUARTERLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: null },
    })
    await prisma.charge.create({
      data: { id: uuidv7(), clientId, planId: plan.id, kind: 'RETAINER', description: `Retainer — ${quarterLabel}`, periodLabel: quarterLabel, amountCents: 30000, issuedOn: asOf, dueOn: asOf },
    })

    const response = await get('/api/v1/billing/current-month')

    const row = response.body.find((item: { clientId: string }) => item.clientId === clientId)
    expect(row).toMatchObject({ paid: false, outstandingCents: 30000 })
  })

  it('leaves a written-off charge out of the client ledger balance', async () => {
    const clientId = await createClient('600000036')
    await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'Incobrável', amountCents: 50000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-08T00:00:00Z'), writtenOffAt: new Date('2026-02-01T00:00:00Z'), writeOffReason: 'Insolvente' },
    })

    const response = await get(`/api/v1/billing/clients/${clientId}/ledger`)

    // The charge stays in the history — a write-off "leaves receivables
    // without leaving history" (master spec §8.2) — but it must not still
    // be counted as owed, or this screen contradicts the receivables one.
    expect(response.body.balanceCents).toBe(0)
    expect(response.body.entries.length).toBeGreaterThanOrEqual(2)
  })

  it('leaves a charge that is not yet due out of receivables', async () => {
    const clientId = await createClient('600000037', 'Not Yet Due')
    await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'Futura', amountCents: 9000, issuedOn: new Date(), dueOn: new Date('2099-01-01T00:00:00Z') },
    })

    const response = await get('/api/v1/billing/receivables')

    expect(response.body.find((row: { clientId: string }) => row.clientId === clientId)).toBeUndefined()
  })
})

describe('getAvailableCredit', () => {
  it('returns each payment with money left, oldest first, and their total', async () => {
    const clientId = await createClient('502111111')
    const older = uuidv7()
    const newer = uuidv7()
    await prisma.payment.create({
      data: { id: older, clientId, amountCents: 10000, receivedOn: new Date('2026-01-10T00:00:00Z'), method: 'TRANSFER' },
    })
    await prisma.payment.create({
      data: { id: newer, clientId, amountCents: 5000, receivedOn: new Date('2026-03-10T00:00:00Z'), method: 'TRANSFER' },
    })

    const credit = await billing.getAvailableCredit(clientId)

    expect(credit.totalCents).toBe(15000)
    expect(credit.sources.map((source) => source.paymentId)).toEqual([older, newer])
    expect(credit.sources[0]?.availableCents).toBe(10000)
    expect(credit.sources[0]?.receivedOn).toBeInstanceOf(Date)
  })

  it('omits a payment that is fully allocated', async () => {
    const clientId = await createClient('502222222')
    const chargeId = uuidv7()
    await prisma.charge.create({
      data: {
        id: chargeId,
        clientId,
        kind: 'EXTRA',
        description: 'Ad-hoc',
        amountCents: 9000,
        issuedOn: new Date('2026-01-01T00:00:00Z'),
        dueOn: new Date('2026-01-31T00:00:00Z'),
      },
    })
    const paymentId = uuidv7()
    await prisma.payment.create({
      data: { id: paymentId, clientId, amountCents: 9000, receivedOn: new Date('2026-02-01T00:00:00Z'), method: 'TRANSFER' },
    })
    await prisma.paymentAllocation.create({ data: { paymentId, chargeId, amountCents: 9000 } })

    const credit = await billing.getAvailableCredit(clientId)

    expect(credit.sources).toEqual([])
    expect(credit.totalCents).toBe(0)
  })

  it("never sees another client's credit", async () => {
    const mine = await createClient('502333333')
    const theirs = await createClient('502444444')
    await prisma.payment.create({
      data: { id: uuidv7(), clientId: theirs, amountCents: 20000, receivedOn: new Date('2026-01-10T00:00:00Z'), method: 'TRANSFER' },
    })

    expect((await billing.getAvailableCredit(mine)).totalCents).toBe(0)
  })
})

describe('POST /billing/clients/:clientId/apply-credit', () => {
  async function clientWithCreditAndCharge(taxId: string, chargeCents: number, paymentCents: number, dueOn = '2026-01-31') {
    const clientId = await createClient(taxId)
    const chargeId = uuidv7()
    await prisma.charge.create({
      data: {
        id: chargeId,
        clientId,
        kind: 'EXTRA',
        description: 'Ad-hoc',
        amountCents: chargeCents,
        issuedOn: new Date('2026-01-01T00:00:00Z'),
        dueOn: new Date(`${dueOn}T00:00:00Z`),
      },
    })
    const paymentId = uuidv7()
    await prisma.payment.create({
      data: { id: paymentId, clientId, amountCents: paymentCents, receivedOn: new Date('2026-01-05T00:00:00Z'), method: 'TRANSFER' },
    })
    return { clientId, chargeId, paymentId }
  }

  it('proposes credit against the open charge without writing anything', async () => {
    const { clientId, chargeId, paymentId } = await clientWithCreditAndCharge('503111111', 9000, 12000)

    const response = await post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=true`)

    expect(response.status).toBe(201)
    expect(response.body.proposed).toEqual([
      expect.objectContaining({ paymentId, chargeId, amountCents: 9000, description: 'Ad-hoc' }),
    ])
    expect(response.body.remainingCreditCents).toBe(3000)
    expect(response.body.allocated).toBe(0)
    expect(await prisma.paymentAllocation.count()).toBe(0)
  })

  it('defaults to a dry run when dryRun is omitted', async () => {
    const { clientId } = await clientWithCreditAndCharge('503222222', 9000, 12000)

    const response = await post(`/api/v1/billing/clients/${clientId}/apply-credit`)

    expect(response.status).toBe(201)
    expect(await prisma.paymentAllocation.count()).toBe(0)
  })

  it('writes the allocations it is given on a confirm', async () => {
    const { clientId, chargeId, paymentId } = await clientWithCreditAndCharge('503333333', 9000, 12000)

    const response = await post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=false`, {
      allocations: [{ paymentId, chargeId, amountCents: 9000 }],
    })

    expect(response.status).toBe(201)
    expect(response.body.allocated).toBe(1)
    const written = await prisma.paymentAllocation.findMany()
    expect(written).toEqual([{ paymentId, chargeId, amountCents: 9000 }])
    // The credit is spent: a second run has nothing to propose.
    const second = await post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=true`)
    expect(second.body.proposed).toEqual([])
    expect(second.body.remainingCreditCents).toBe(3000)
  })

  it('proposes nothing, and does not error, when no charge has fallen due yet', async () => {
    const clientId = await createClient('503444444')
    await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'Next month',
        amountCents: 9000,
        issuedOn: new Date('2026-01-01T00:00:00Z'),
        // Due far enough out that `asOf` (now) cannot have reached it.
        dueOn: new Date('2099-01-31T00:00:00Z'),
      },
    })
    await prisma.payment.create({
      data: { id: uuidv7(), clientId, amountCents: 12000, receivedOn: new Date('2026-01-05T00:00:00Z'), method: 'TRANSFER' },
    })

    const response = await post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=true`)

    expect(response.status).toBe(201)
    expect(response.body.proposed).toEqual([])
    expect(response.body.remainingCreditCents).toBe(12000)
  })

  it('never proposes credit against a written-off charge', async () => {
    const { clientId, chargeId } = await clientWithCreditAndCharge('503555555', 9000, 12000)
    await prisma.charge.update({ where: { id: chargeId }, data: { writtenOffAt: new Date(), writeOffReason: 'Goodwill' } })

    const response = await post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=true`)

    expect(response.body.proposed).toEqual([])
    expect(response.body.remainingCreditCents).toBe(12000)
  })

  it('rejects an allocation drawing more than the payment has left', async () => {
    const { clientId, chargeId, paymentId } = await clientWithCreditAndCharge('503666666', 20000, 5000)

    const response = await post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=false`, {
      allocations: [{ paymentId, chargeId, amountCents: 9000 }],
    })

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('billing.allocation_exceeds_available_credit')
    expect(await prisma.paymentAllocation.count()).toBe(0)
  })

  it("rejects an allocation drawing on another client's payment", async () => {
    const mine = await clientWithCreditAndCharge('503777777', 9000, 100)
    const theirs = await clientWithCreditAndCharge('503888888', 9000, 12000)

    const response = await post(`/api/v1/billing/clients/${mine.clientId}/apply-credit?dryRun=false`, {
      allocations: [{ paymentId: theirs.paymentId, chargeId: mine.chargeId, amountCents: 1 }],
    })

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('billing.allocation_exceeds_available_credit')
    expect(await prisma.paymentAllocation.count()).toBe(0)
  })

  it('serialises two confirms racing for the same credit', async () => {
    const { clientId, chargeId, paymentId } = await clientWithCreditAndCharge('503999999', 20000, 9000)

    const body = { allocations: [{ paymentId, chargeId, amountCents: 9000 }] }
    const [first, second] = await Promise.all([
      post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=false`, body),
      post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=false`, body),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([201, 422])
    // 90,00 EUR of credit can only be spent once, whichever request won.
    const total = await prisma.paymentAllocation.aggregate({ _sum: { amountCents: true } })
    expect(total._sum.amountCents).toBe(9000)
  })
})

describe('generateCharges and client credit', () => {
  async function clientWithPlanAndCredit(taxId: string, creditCents: number) {
    const clientId = await createClient(taxId)
    await prisma.retainerPlan.create({
      data: {
        id: uuidv7(),
        clientId,
        amountCents: 9000,
        periodicity: 'MONTHLY',
        dueDayOfMonth: 8,
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validTo: null,
      },
    })
    await prisma.payment.create({
      data: { id: uuidv7(), clientId, amountCents: creditCents, receivedOn: new Date('2026-01-02T00:00:00Z'), method: 'TRANSFER' },
    })
    return clientId
  }

  it('previews the credit it would spend on the charges it would create', async () => {
    const clientId = await clientWithPlanAndCredit('504111111', 27000)

    const result = await billing.generateCharges({ asOf: new Date('2026-03-15T00:00:00Z'), clientId }, true)

    expect(result.toCreate).toHaveLength(3)
    expect(result.created).toBe(0)
    expect(result.allocated).toBe(0)
    // Three 90,00 EUR charges, 270,00 EUR of credit: all three settled.
    expect(result.creditToAllocate.reduce((sum, row) => sum + row.amountCents, 0)).toBe(27000)
    expect(await prisma.charge.count()).toBe(0)
    expect(await prisma.paymentAllocation.count()).toBe(0)
  })

  it('creates the charges and spends the credit in one run', async () => {
    const clientId = await clientWithPlanAndCredit('504222222', 27000)

    const result = await billing.generateCharges({ asOf: new Date('2026-03-15T00:00:00Z'), clientId }, false)

    expect(result.created).toBe(3)
    expect(result.allocated).toBe(3)
    const balances = await prisma.$queryRaw<Array<{ outstandingCents: number }>>`
      SELECT "outstandingCents" FROM charge_balances WHERE "clientId" = ${clientId}::uuid
    `
    expect(balances.every((row) => row.outstandingCents === 0)).toBe(true)
    expect((await billing.getAvailableCredit(clientId)).totalCents).toBe(0)
  })

  it('spends partial credit across as many charges as it reaches', async () => {
    const clientId = await clientWithPlanAndCredit('504333333', 10000)

    await billing.generateCharges({ asOf: new Date('2026-03-15T00:00:00Z'), clientId }, false)

    const balances = await prisma.$queryRaw<Array<{ outstandingCents: number; dueOn: Date }>>`
      SELECT "outstandingCents", "dueOn" FROM charge_balances WHERE "clientId" = ${clientId}::uuid ORDER BY "dueOn" ASC
    `
    // 100,00 EUR against three 90,00 EUR charges: the first settled, the
    // second 10,00 EUR in, the third untouched.
    expect(balances.map((row) => row.outstandingCents)).toEqual([0, 8000, 9000])
  })

  it('generates charges unchanged for a client with no credit', async () => {
    const clientId = await createClient('504444444')
    await prisma.retainerPlan.create({
      data: {
        id: uuidv7(),
        clientId,
        amountCents: 9000,
        periodicity: 'MONTHLY',
        dueDayOfMonth: 8,
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validTo: null,
      },
    })

    const result = await billing.generateCharges({ asOf: new Date('2026-02-15T00:00:00Z'), clientId }, false)

    expect(result.created).toBe(2)
    expect(result.allocated).toBe(0)
    expect(result.creditToAllocate).toEqual([])
  })
})

describe('getReceivables and client credit', () => {
  async function overdueClient(taxId: string, name: string, charges: Array<{ cents: number; dueOn: string }>, creditCents = 0) {
    const clientId = await createClient(taxId, name)
    for (const charge of charges) {
      await prisma.charge.create({
        data: {
          id: uuidv7(),
          clientId,
          kind: 'EXTRA',
          description: `Ad-hoc ${charge.dueOn}`,
          amountCents: charge.cents,
          issuedOn: new Date('2026-01-01T00:00:00Z'),
          dueOn: new Date(`${charge.dueOn}T00:00:00Z`),
        },
      })
    }
    if (creditCents > 0) {
      await prisma.payment.create({
        data: { id: uuidv7(), clientId, amountCents: creditCents, receivedOn: new Date('2026-01-02T00:00:00Z'), method: 'TRANSFER' },
      })
    }
    return clientId
  }

  const asOf = new Date('2026-06-30T00:00:00Z')

  it('nets credit off the debt and reports both parts', async () => {
    const clientId = await overdueClient('505111111', 'Partly Covered', [{ cents: 20000, dueOn: '2026-05-31' }], 15000)

    const [row] = await billing.getReceivables(asOf)

    expect(row?.clientId).toBe(clientId)
    expect(row?.grossOutstandingCents).toBe(20000)
    expect(row?.creditCents).toBe(15000)
    expect(row?.outstandingCents).toBe(5000)
  })

  it('drops a client whose credit covers everything, and never reports a negative', async () => {
    await overdueClient('505222222', 'Fully Covered', [{ cents: 9000, dueOn: '2026-05-31' }], 30000)

    expect(await billing.getReceivables(asOf)).toEqual([])
  })

  it('ages by the oldest charge the credit does not reach', async () => {
    await overdueClient(
      '505333333',
      'Aged',
      [
        // 210+ days overdue, settled on paper by the credit.
        { cents: 9000, dueOn: '2026-01-05' },
        // ~30 days overdue, the one that still stands.
        { cents: 9000, dueOn: '2026-06-01' },
      ],
      9000,
    )

    const [row] = await billing.getReceivables(asOf)

    expect(row?.oldestDueOn).toBe('2026-06-01')
    expect(row?.ageingBucket).toBe('0-30')
  })

  it('leaves a client with no credit exactly as before', async () => {
    await overdueClient('505444444', 'Plain Debtor', [{ cents: 9000, dueOn: '2026-01-05' }])

    const [row] = await billing.getReceivables(asOf)

    expect(row?.grossOutstandingCents).toBe(9000)
    expect(row?.creditCents).toBe(0)
    expect(row?.outstandingCents).toBe(9000)
    expect(row?.ageingBucket).toBe('90+')
  })

  it('does not let credit settle a written-off charge', async () => {
    const clientId = await overdueClient('505555555', 'Forgiven', [{ cents: 9000, dueOn: '2026-05-31' }], 9000)
    const charge = await prisma.charge.findFirstOrThrow({ where: { clientId } })
    await prisma.charge.update({ where: { id: charge.id }, data: { writtenOffAt: new Date(), writeOffReason: 'Goodwill' } })

    // Nothing is owed, so nothing is listed — but the credit must still be
    // intact, not quietly consumed by a debt that was forgiven.
    expect(await billing.getReceivables(asOf)).toEqual([])
    expect((await billing.getAvailableCredit(clientId)).totalCents).toBe(9000)
  })
})

describe('getClientLedger and client credit', () => {
  it('reports unspent payment money as available credit', async () => {
    const clientId = await createClient('506111111')
    await prisma.payment.create({
      data: { id: uuidv7(), clientId, amountCents: 27000, receivedOn: new Date('2026-01-05T00:00:00Z'), method: 'TRANSFER' },
    })

    const ledger = await billing.getClientLedger(clientId)

    expect(ledger.availableCreditCents).toBe(27000)
    // The running balance already netted the payment in full before this
    // phase; that behaviour is unchanged.
    expect(ledger.balanceCents).toBe(-27000)
  })

  it('reports zero once every cent is allocated', async () => {
    const clientId = await createClient('506222222')
    const chargeId = uuidv7()
    await prisma.charge.create({
      data: {
        id: chargeId,
        clientId,
        kind: 'EXTRA',
        description: 'Ad-hoc',
        amountCents: 9000,
        issuedOn: new Date('2026-01-01T00:00:00Z'),
        dueOn: new Date('2026-01-31T00:00:00Z'),
      },
    })
    const paymentId = uuidv7()
    await prisma.payment.create({
      data: { id: paymentId, clientId, amountCents: 9000, receivedOn: new Date('2026-02-01T00:00:00Z'), method: 'TRANSFER' },
    })
    await prisma.paymentAllocation.create({ data: { paymentId, chargeId, amountCents: 9000 } })

    expect((await billing.getClientLedger(clientId)).availableCreditCents).toBe(0)
  })
})
