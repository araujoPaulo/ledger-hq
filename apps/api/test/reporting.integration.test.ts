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
