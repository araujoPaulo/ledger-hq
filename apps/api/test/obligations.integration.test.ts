import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app.js'
import { resetDatabase } from './database.js'
import { authenticate } from './authenticate.js'

let app: INestApplication
let cookie: string[]

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

function post(path: string, body: Record<string, unknown> = {}) {
  return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq').send(body)
}

function patch(path: string, body: Record<string, unknown>) {
  return request(app.getHttpServer()).patch(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq').send(body)
}

async function createCompanyWithProfile() {
  const client = await post('/api/v1/clients', {
    kind: 'COMPANY',
    name: 'Padaria Central, Lda.',
    taxId: '501442600',
    accounting: 'ORGANIZED',
    legalForm: 'LDA',
  }).expect(201)

  await request(app.getHttpServer())
    .put(`/api/v1/clients/${client.body.id}/fiscal-profile`)
    .set('Cookie', cookie)
    .set('X-Requested-With', 'ledger-hq')
    .send({
      hasOpenActivity: true,
      vatRegime: 'MONTHLY',
      incomeTax: 'CIT',
      hasEmployees: false,
      hasWithholding: false,
      isVatCashBasis: false,
      startedAt: '2020-01-01',
    })
    .expect(200)

  return client.body.id as string
}

describe('obligation generation and listing', () => {
  it('generate with dryRun=true proposes instances without persisting them', async () => {
    const clientId = await createCompanyWithProfile()

    const dryRun = await post(`/api/v1/obligations/generate?dryRun=true`, { asOf: '2026-03-18', clientId }).expect(201)
    expect(dryRun.body.toCreate.length).toBeGreaterThan(0)

    const listed = await request(app.getHttpServer()).get('/api/v1/obligations').set('Cookie', cookie).expect(200)
    expect(listed.body).toEqual([])
  })

  it('generate with dryRun=false persists the proposed instances, then lists them', async () => {
    const clientId = await createCompanyWithProfile()

    await post(`/api/v1/obligations/generate?dryRun=false`, { asOf: '2026-03-18', clientId }).expect(201)

    const listed = await request(app.getHttpServer()).get('/api/v1/obligations').set('Cookie', cookie).expect(200)
    expect(listed.body.length).toBeGreaterThan(0)
    expect(listed.body[0]).toMatchObject({ clientId, status: 'PENDING' })
  })

  it('filters the list by clientId', async () => {
    const clientId = await createCompanyWithProfile()
    await post(`/api/v1/obligations/generate?dryRun=false`, { asOf: '2026-03-18', clientId }).expect(201)

    const listed = await request(app.getHttpServer())
      .get(`/api/v1/obligations?clientId=${clientId}`)
      .set('Cookie', cookie)
      .expect(200)
    expect(listed.body.length).toBeGreaterThan(0)
    expect(listed.body.every((item: { clientId: string }) => item.clientId === clientId)).toBe(true)
  })
})

describe('manual adjustment', () => {
  it('overriding the due date sets dueDateOverridden', async () => {
    const clientId = await createCompanyWithProfile()
    await post(`/api/v1/obligations/generate?dryRun=false`, { asOf: '2026-03-18', clientId }).expect(201)
    const listed = await request(app.getHttpServer()).get('/api/v1/obligations').set('Cookie', cookie).expect(200)
    const target = listed.body[0]

    const response = await patch(`/api/v1/obligations/${target.id}`, { dueDate: '2026-04-01' }).expect(200)

    expect(response.body.dueDate).toBe('2026-04-01')
    expect(response.body.dueDateOverridden).toBe(true)
  })

  it('rejects marking WAIVED with no reason', async () => {
    const clientId = await createCompanyWithProfile()
    await post(`/api/v1/obligations/generate?dryRun=false`, { asOf: '2026-03-18', clientId }).expect(201)
    const listed = await request(app.getHttpServer()).get('/api/v1/obligations').set('Cookie', cookie).expect(200)
    const target = listed.body[0]

    const response = await patch(`/api/v1/obligations/${target.id}`, { status: 'WAIVED' })

    expect(response.status).toBe(422)
  })

  it('accepts marking WAIVED with a reason', async () => {
    const clientId = await createCompanyWithProfile()
    await post(`/api/v1/obligations/generate?dryRun=false`, { asOf: '2026-03-18', clientId }).expect(201)
    const listed = await request(app.getHttpServer()).get('/api/v1/obligations').set('Cookie', cookie).expect(200)
    const target = listed.body[0]

    const response = await patch(`/api/v1/obligations/${target.id}`, { status: 'WAIVED', notes: 'Client ceased activity' }).expect(200)

    expect(response.body.status).toBe('WAIVED')
  })

  it('404s adjusting an unknown instance', async () => {
    await patch('/api/v1/obligations/00000000-0000-7000-8000-000000000099', { notes: 'x' }).expect(404)
  })

  it('waiving an instance that already has notes needs no new text — the server checks the payload, and the client always resends it', async () => {
    const clientId = await createCompanyWithProfile()
    await post(`/api/v1/obligations/generate?dryRun=false`, { asOf: '2026-03-18', clientId }).expect(201)
    const listed = await request(app.getHttpServer()).get('/api/v1/obligations').set('Cookie', cookie).expect(200)
    const target = listed.body[0]
    await patch(`/api/v1/obligations/${target.id}`, { notes: 'Pre-existing note' }).expect(200)

    // A client that resends the existing notes alongside the status change
    // (the fixed AdjustObligationForm's own behaviour) must succeed — this
    // is the server-side half of that fix's contract.
    const response = await patch(`/api/v1/obligations/${target.id}`, { status: 'WAIVED', notes: 'Pre-existing note' })

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('WAIVED')
  })

  it('an overridden due date is not touched by a later generate run for the same client', async () => {
    const clientId = await createCompanyWithProfile()
    await post(`/api/v1/obligations/generate?dryRun=false`, { asOf: '2026-03-18', clientId }).expect(201)
    const listed = await request(app.getHttpServer()).get('/api/v1/obligations').set('Cookie', cookie).expect(200)
    const target = listed.body[0]
    await patch(`/api/v1/obligations/${target.id}`, { dueDate: '2026-12-31' }).expect(200)

    // Re-running generate for the same client/asOf must not recreate,
    // duplicate, or revert this instance's manually-overridden date (master
    // spec §7.4) — proven end to end, not just by the flag being set once.
    await post(`/api/v1/obligations/generate?dryRun=false`, { asOf: '2026-03-18', clientId }).expect(201)

    const refetched = await request(app.getHttpServer()).get(`/api/v1/obligations?clientId=${clientId}`).set('Cookie', cookie).expect(200)
    const stillThere = refetched.body.find((item: { id: string }) => item.id === target.id)
    expect(stillThere).toMatchObject({ dueDate: '2026-12-31', dueDateOverridden: true })
  })
})

describe('ad-hoc obligations', () => {
  it('creates an ad-hoc obligation with its own CUSTOM definition', async () => {
    const clientId = await createCompanyWithProfile()

    const response = await post('/api/v1/obligations', {
      clientId,
      code: 'BACKUP_RESTORE_DRILL',
      name: 'Backup restore drill',
      periodicity: 'ONE_OFF',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-01',
      periodLabel: '2026',
      dueDate: '2026-06-30',
    }).expect(201)

    expect(response.body).toMatchObject({ clientId, definitionCode: 'BACKUP_RESTORE_DRILL', status: 'PENDING' })
  })

  it('rejects an ad-hoc code that collides with a CATALOG definition', async () => {
    const clientId = await createCompanyWithProfile()
    await post(`/api/v1/obligations/generate?dryRun=false`, { asOf: '2026-03-18', clientId }).expect(201) // seeds CATALOG definitions

    const response = await post('/api/v1/obligations', {
      clientId,
      code: 'VAT_MONTHLY_RETURN',
      name: 'Hijacked',
      periodicity: 'ONE_OFF',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-01',
      periodLabel: '2026',
      dueDate: '2026-06-30',
    })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('obligations.definition_code_taken')
  })

  it('rejects creating the exact same ad-hoc obligation twice, as a 409 rather than a 500', async () => {
    const clientId = await createCompanyWithProfile()
    const body = {
      clientId,
      code: 'BACKUP_RESTORE_DRILL',
      name: 'Backup restore drill',
      periodicity: 'ONE_OFF',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-01',
      periodLabel: '2026',
      dueDate: '2026-06-30',
    }
    await post('/api/v1/obligations', body).expect(201)

    const response = await post('/api/v1/obligations', body)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('obligations.ad_hoc_already_exists')
  })
})
