import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from 'uuidv7'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { getTestPrisma, resetDatabase } from './database.js'
import { createTestApp } from './app.js'
import { authenticate } from './authenticate.js'

const prisma = getTestPrisma()

let app: INestApplication
let cookie: string[]

const AS_OF = '2026-06-30'

async function createClient(taxId: string, name: string): Promise<string> {
  const client = await prisma.client.create({
    data: { id: uuidv7(), kind: 'COMPANY', name, taxId, accounting: 'ORGANIZED', legalForm: 'LDA' },
  })
  return client.id
}

async function overdueObligation(clientId: string, periodLabel: string, dueDate: string): Promise<void> {
  await prisma.obligationDefinition.upsert({
    where: { code: 'IVA_TRIM' },
    create: { code: 'IVA_TRIM', name: 'IVA trimestral', authority: 'TAX', periodicity: 'QUARTERLY', source: 'CATALOG' },
    update: {},
  })
  await prisma.obligationInstance.create({
    data: {
      id: uuidv7(),
      clientId,
      definitionCode: 'IVA_TRIM',
      periodStart: new Date(`${dueDate}T00:00:00Z`),
      periodEnd: new Date(`${dueDate}T00:00:00Z`),
      periodLabel,
      dueDate: new Date(`${dueDate}T00:00:00Z`),
    },
  })
}

async function openCharge(clientId: string, amountCents: number, dueOn: string): Promise<string> {
  const charge = await prisma.charge.create({
    data: {
      id: uuidv7(),
      clientId,
      kind: 'EXTRA',
      description: `Ad-hoc ${dueOn}`,
      amountCents,
      issuedOn: new Date('2026-01-01T00:00:00Z'),
      dueOn: new Date(`${dueOn}T00:00:00Z`),
    },
  })
  return charge.id
}

function get(path: string) {
  return request(app.getHttpServer()).get(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq')
}

function post(path: string, body: Record<string, unknown> = {}) {
  return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq').send(body)
}

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

describe('GET /api/v1/reporting/at-risk', () => {
  it('lists a client that is both overdue and in arrears', async () => {
    const clientId = await createClient('501111111', 'Padaria Central, Lda.')
    await overdueObligation(clientId, '2026-Q1', '2026-05-15')
    await openCharge(clientId, 20000, '2026-05-31')

    const response = await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual([
      expect.objectContaining({
        clientId,
        clientName: 'Padaria Central, Lda.',
        overdueObligations: 1,
        oldestDueDate: '2026-05-15',
        grossOutstandingCents: 20000,
        creditCents: 0,
        outstandingCents: 20000,
        oldestChargeDueOn: '2026-05-31',
      }),
    ])
  })

  it('omits a client that is overdue but paid up', async () => {
    const clientId = await createClient('501222222', 'Só Atrasado, Lda.')
    await overdueObligation(clientId, '2026-Q1', '2026-05-15')

    expect((await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)).body).toEqual([])
  })

  it('omits a client that is in arrears but up to date on deadlines', async () => {
    const clientId = await createClient('501333333', 'Só Devedor, Lda.')
    await openCharge(clientId, 20000, '2026-05-31')

    expect((await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)).body).toEqual([])
  })

  it('omits an obligation that is done, however late it was', async () => {
    const clientId = await createClient('501444444', 'Entregue, Lda.')
    await overdueObligation(clientId, '2026-Q1', '2026-05-15')
    await prisma.obligationInstance.updateMany({ where: { clientId }, data: { status: 'DONE', completedAt: new Date() } })
    await openCharge(clientId, 20000, '2026-05-31')

    expect((await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)).body).toEqual([])
  })

  // Review Focus 4: the reason the query uses two CTEs.
  it('counts obligation instances, not join rows', async () => {
    const clientId = await createClient('501555555', 'Multiplicado, Lda.')
    await overdueObligation(clientId, '2026-Q1', '2026-03-15')
    await overdueObligation(clientId, '2026-Q2', '2026-04-15')
    await overdueObligation(clientId, '2026-Q3', '2026-05-15')
    await openCharge(clientId, 1000, '2026-02-28')
    await openCharge(clientId, 2000, '2026-03-31')
    await openCharge(clientId, 3000, '2026-04-30')
    await openCharge(clientId, 4000, '2026-05-31')

    const [row] = (await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)).body

    // Three obligations and four charges. A single-pass join reports 12 and
    // 30000; the CTEs report 3 and 10000.
    expect(row.overdueObligations).toBe(3)
    expect(row.grossOutstandingCents).toBe(10000)
  })

  // The Phase 4a contract: credit is netted, and a client it fully covers is
  // not in arrears.
  it('nets unspent credit, and drops a client whose credit covers the debt', async () => {
    const partly = await createClient('501666666', 'Parcialmente Coberto, Lda.')
    await overdueObligation(partly, '2026-Q1', '2026-05-15')
    await openCharge(partly, 20000, '2026-05-31')
    await prisma.payment.create({
      data: { id: uuidv7(), clientId: partly, amountCents: 15000, receivedOn: new Date('2026-01-05T00:00:00Z'), method: 'TRANSFER' },
    })

    const fully = await createClient('501777777', 'Totalmente Coberto, Lda.')
    await overdueObligation(fully, '2026-Q1', '2026-05-15')
    await openCharge(fully, 9000, '2026-05-31')
    await prisma.payment.create({
      data: { id: uuidv7(), clientId: fully, amountCents: 30000, receivedOn: new Date('2026-01-05T00:00:00Z'), method: 'TRANSFER' },
    })

    const body = (await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)).body

    expect(body).toHaveLength(1)
    expect(body[0]).toEqual(
      expect.objectContaining({ clientId: partly, grossOutstandingCents: 20000, creditCents: 15000, outstandingCents: 5000 }),
    )
  })

  // Fix round 1: `oldestChargeDueOn` must name the same charge the
  // receivables screen points at. Credit fully covers the oldest charge and
  // only partially covers the second; a `MIN(dueOn)` over the raw balances
  // would wrongly report the oldest charge on file — the one the client's
  // own money has already answered — instead of the first charge the
  // credit still fails to reach in full.
  it('names the oldest charge the credit does not reach, not the oldest charge on file', async () => {
    const clientId = await createClient('501111222', 'Parcialmente Cobrado, Lda.')
    await overdueObligation(clientId, '2026-Q1', '2026-02-15')
    await openCharge(clientId, 5000, '2026-03-31')
    await openCharge(clientId, 8000, '2026-04-30')
    await openCharge(clientId, 3000, '2026-05-31')
    await prisma.payment.create({
      data: { id: uuidv7(), clientId, amountCents: 9000, receivedOn: new Date('2026-01-05T00:00:00Z'), method: 'TRANSFER' },
    })

    const [row] = (await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)).body

    // Credit (9000) fully covers the 5000 charge and reaches 4000 into the
    // 8000 charge, leaving it partially outstanding — the third charge is
    // never even considered, because the second is already the oldest
    // uncovered one.
    expect(row).toEqual(
      expect.objectContaining({
        clientId,
        grossOutstandingCents: 16000,
        creditCents: 9000,
        outstandingCents: 7000,
        oldestChargeDueOn: '2026-04-30',
      }),
    )
  })

  it('excludes archived clients and written-off charges', async () => {
    const archived = await createClient('501888888', 'Arquivado, Lda.')
    await overdueObligation(archived, '2026-Q1', '2026-05-15')
    await openCharge(archived, 20000, '2026-05-31')
    await prisma.client.update({ where: { id: archived }, data: { archivedAt: new Date() } })

    const forgiven = await createClient('501999999', 'Perdoado, Lda.')
    await overdueObligation(forgiven, '2026-Q1', '2026-05-15')
    const chargeId = await openCharge(forgiven, 20000, '2026-05-31')
    await prisma.charge.update({ where: { id: chargeId }, data: { writtenOffAt: new Date(), writeOffReason: 'Cortesia' } })

    expect((await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)).body).toEqual([])
  })

  // ADR 0007: a missed ::int hands back a bigint and fails at serialization,
  // in the response, not at migration time.
  it('returns every numeric field as a JSON-safe number', async () => {
    const clientId = await createClient('502111111', 'Padaria Central, Lda.')
    await overdueObligation(clientId, '2026-Q1', '2026-05-15')
    await openCharge(clientId, 20000, '2026-05-31')

    const [row] = (await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)).body

    expect(typeof row.overdueObligations).toBe('number')
    expect(typeof row.grossOutstandingCents).toBe('number')
    expect(typeof row.creditCents).toBe('number')
    expect(typeof row.outstandingCents).toBe('number')
  })

  it('rejects a malformed asOf', async () => {
    const response = await get('/api/v1/reporting/at-risk?asOf=29/09/2026')

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('common.validation_failed')
  })

  it('requires a session', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/reporting/at-risk')

    expect(response.status).toBe(401)
  })
})

describe('GET /api/v1/reporting/period-summary', () => {
  it('counts obligations due and done inside the window', async () => {
    const clientId = await createClient('503111111', 'Padaria Central, Lda.')
    await overdueObligation(clientId, '2026-Q1', '2026-02-15')
    await overdueObligation(clientId, '2026-Q2', '2026-05-15')
    await prisma.obligationInstance.updateMany({
      where: { clientId, periodLabel: '2026-Q1' },
      data: { status: 'DONE', completedAt: new Date('2026-02-20T00:00:00Z') },
    })

    const response = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')

    expect(response.status).toBe(200)
    expect(response.body).toEqual(
      expect.objectContaining({ from: '2026-01-01', to: '2026-03-31', obligationsDue: 1, obligationsDone: 1 }),
    )
  })

  it('sums charges issued and payments received inside the window only', async () => {
    const clientId = await createClient('503222222', 'Padaria Central, Lda.')
    await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'Dentro',
        amountCents: 9000,
        issuedOn: new Date('2026-02-01T00:00:00Z'),
        dueOn: new Date('2026-02-28T00:00:00Z'),
      },
    })
    await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'Fora',
        amountCents: 5000,
        issuedOn: new Date('2026-04-01T00:00:00Z'),
        dueOn: new Date('2026-04-30T00:00:00Z'),
      },
    })
    await prisma.payment.create({
      data: { id: uuidv7(), clientId, amountCents: 4000, receivedOn: new Date('2026-02-10T00:00:00Z'), method: 'TRANSFER' },
    })
    await prisma.payment.create({
      data: { id: uuidv7(), clientId, amountCents: 7000, receivedOn: new Date('2026-04-10T00:00:00Z'), method: 'TRANSFER' },
    })

    const response = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')

    expect(response.body.chargesIssuedCents).toBe(9000)
    expect(response.body.paymentsReceivedCents).toBe(4000)
  })

  it('reports the position at the close of the window, not today', async () => {
    const clientId = await createClient('503333333', 'Padaria Central, Lda.')
    const charge = await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'Cobrança',
        amountCents: 9000,
        issuedOn: new Date('2026-02-01T00:00:00Z'),
        dueOn: new Date('2026-02-28T00:00:00Z'),
      },
    })
    // Paid AFTER the window closed, so at close it was still outstanding.
    const paymentId = uuidv7()
    await prisma.payment.create({
      data: { id: paymentId, clientId, amountCents: 9000, receivedOn: new Date('2026-05-10T00:00:00Z'), method: 'TRANSFER' },
    })
    await prisma.paymentAllocation.create({ data: { id: uuidv7(), paymentId, chargeId: charge.id, amountCents: 9000 } })

    const response = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')

    expect(response.body.outstandingAtCloseCents).toBe(9000)
  })

  it('returns zeros for an empty window rather than nulls', async () => {
    const response = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')

    expect(response.body).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
      obligationsDue: 0,
      obligationsDone: 0,
      chargesIssuedCents: 0,
      paymentsReceivedCents: 0,
      outstandingAtCloseCents: 0,
    })
  })

  it('returns every numeric field as a JSON-safe number', async () => {
    const clientId = await createClient('503444444', 'Padaria Central, Lda.')
    await prisma.payment.create({
      data: { id: uuidv7(), clientId, amountCents: 4000, receivedOn: new Date('2026-02-10T00:00:00Z'), method: 'TRANSFER' },
    })

    const response = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')

    for (const key of ['obligationsDue', 'obligationsDone', 'chargesIssuedCents', 'paymentsReceivedCents', 'outstandingAtCloseCents']) {
      expect(typeof response.body[key]).toBe('number')
    }
  })

  it('rejects a window that ends before it starts', async () => {
    const response = await get('/api/v1/reporting/period-summary?from=2026-03-31&to=2026-01-01')

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('common.validation_failed')
  })

  it('includes an obligation, charge and payment dated exactly on the closing day', async () => {
    const clientId = await createClient('503777777', 'Padaria Central, Lda.')
    await overdueObligation(clientId, '2026-Q1', '2026-03-31')
    await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'No fecho',
        amountCents: 3000,
        issuedOn: new Date('2026-03-31T00:00:00Z'),
        dueOn: new Date('2026-03-31T00:00:00Z'),
      },
    })
    await prisma.payment.create({
      data: { id: uuidv7(), clientId, amountCents: 2000, receivedOn: new Date('2026-03-31T00:00:00Z'), method: 'TRANSFER' },
    })

    const response = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')

    expect(response.body.obligationsDue).toBe(1)
    expect(response.body.chargesIssuedCents).toBe(3000)
    expect(response.body.paymentsReceivedCents).toBe(2000)
  })

  // Reproduces the fix-round-1 defect: BillingService#applyCredit can write
  // a PaymentAllocation row against an existing payment long after that
  // payment's receivedOn. A closed period's summary must not change once
  // that later allocation exists — it must still answer as it did before
  // the credit was applied.
  it('does not change once a closed period is re-summarised after credit is applied to it later', async () => {
    const clientId = await createClient('503888888', 'Padaria Central, Lda.')
    const charge = await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'Fevereiro',
        amountCents: 5000,
        issuedOn: new Date('2026-02-01T00:00:00Z'),
        dueOn: new Date('2026-02-28T00:00:00Z'),
      },
    })
    const paymentId = uuidv7()
    // Received inside the window, but not yet allocated to anything: the
    // whole amount sits as unspent credit as of the close.
    await prisma.payment.create({
      data: { id: paymentId, clientId, amountCents: 5000, receivedOn: new Date('2026-01-15T00:00:00Z'), method: 'TRANSFER' },
    })

    const before = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')
    expect(before.body.outstandingAtCloseCents).toBe(5000)

    // The credit is applied well after the window closed.
    const applied = await post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=false`, {
      allocations: [{ paymentId, chargeId: charge.id, amountCents: 5000 }],
    })
    expect(applied.status).toBe(201)

    const after = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')
    expect(after.body).toEqual(before.body)
  })

  // Reproduces the fix-round-2 defect: a charge already partly covered by
  // one allocation from a payment, later topped up from the *same*
  // payment's remaining credit. Under upsert-and-increment, the top-up
  // overwrote amountCents on the original January row without moving its
  // createdAt, so an already-closed period silently counted April's money
  // as settled by 31 March. FIFO makes this the ordinary path for a
  // partially covered charge, not a corner case.
  it('does not change once a closed period is re-summarised after a later top-up on an already-partly-allocated charge', async () => {
    const clientId = await createClient('503777000', 'Padaria Central, Lda.')
    const charge = await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'Março',
        amountCents: 5000,
        issuedOn: new Date('2026-02-01T00:00:00Z'),
        dueOn: new Date('2026-02-28T00:00:00Z'),
      },
    })

    // January: a 5000 payment, only 3000 of it allocated to the charge at
    // the time (its own createdAt backdated to when that write actually
    // happened — the live clock during a test run is always "now", which
    // is after this window, so the real API can't produce a January row;
    // the point under test is the top-up below, which does go through the
    // real endpoint) — the remaining 2000 sits as unspent credit on this
    // same payment until the top-up.
    const paymentId = uuidv7()
    await prisma.payment.create({
      data: { id: paymentId, clientId, amountCents: 5000, receivedOn: new Date('2026-01-15T00:00:00Z'), method: 'TRANSFER' },
    })
    await prisma.paymentAllocation.create({
      data: { id: uuidv7(), paymentId, chargeId: charge.id, amountCents: 3000, createdAt: new Date('2026-01-20T00:00:00Z') },
    })

    const before = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')
    expect(before.body.outstandingAtCloseCents).toBe(2000)

    // The remaining 2000 credit from the SAME payment tops up the SAME
    // charge, well after the window closed.
    const applied = await post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=false`, {
      allocations: [{ paymentId, chargeId: charge.id, amountCents: 2000 }],
    })
    expect(applied.status).toBe(201)

    const after = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')
    expect(after.body).toEqual(before.body)
  })

  // `createdAt` is a timestamp, unlike the `@db.Date` columns the other
  // boundary test covers — an allocation made at 15:00 on the closing day
  // must still count as "by close", not just one made at its midnight start.
  it('treats an allocation created any time during the closing day as settled by close', async () => {
    const clientId = await createClient('503999999', 'Padaria Central, Lda.')
    const charge = await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'No fecho',
        amountCents: 4000,
        issuedOn: new Date('2026-02-01T00:00:00Z'),
        dueOn: new Date('2026-02-28T00:00:00Z'),
      },
    })
    const paymentId = uuidv7()
    await prisma.payment.create({
      data: { id: paymentId, clientId, amountCents: 4000, receivedOn: new Date('2026-01-15T00:00:00Z'), method: 'TRANSFER' },
    })
    await prisma.paymentAllocation.create({
      data: { id: uuidv7(), paymentId, chargeId: charge.id, amountCents: 4000, createdAt: new Date('2026-03-31T15:00:00Z') },
    })

    const response = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')

    expect(response.body.outstandingAtCloseCents).toBe(0)
  })
})
