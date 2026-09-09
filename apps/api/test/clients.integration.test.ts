import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app.js'
import { resetDatabase } from './database.js'
import { authenticate } from './authenticate.js'

const company = {
  kind: 'COMPANY',
  name: 'Padaria Central, Lda.',
  taxId: '501442600',
  accounting: 'ORGANIZED',
  legalForm: 'LDA',
}

const individual = {
  kind: 'INDIVIDUAL',
  name: 'Maria Santos',
  taxId: '123456789',
  accounting: 'SIMPLIFIED',
  socialSecurityNo: '11234567890',
  dateOfBirth: '1980-07-14',
}

let app: INestApplication
let cookie: string[]

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

function post(path: string, body: Record<string, unknown>) {
  return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq').send(body)
}

function get(path: string) {
  return request(app.getHttpServer()).get(path).set('Cookie', cookie)
}

describe('POST /clients', () => {
  it('creates a company', async () => {
    const response = await post('/api/v1/clients', company).expect(201)

    expect(response.body).toMatchObject({ ...company, archivedAt: null })
    expect(response.body.id).toEqual(expect.any(String))
  })

  it('creates an individual with personal fields', async () => {
    const response = await post('/api/v1/clients', individual).expect(201)

    expect(response.body.dateOfBirth).toBe('1980-07-14')
    expect(response.body.socialSecurityNo).toBe('11234567890')
  })

  it('rejects a duplicate tax number', async () => {
    await post('/api/v1/clients', company).expect(201)

    const response = await post('/api/v1/clients', { ...company, name: 'Other' }).expect(409)

    expect(response.body).toEqual({
      error: { code: 'clients.tax_id_taken', params: { taxId: '501442600' } },
    })
  })

  it('rejects an invalid payload with per-field issues', async () => {
    const response = await post('/api/v1/clients', { ...company, taxId: '000000000' }).expect(422)

    expect(response.body.error.code).toBe('common.validation_failed')
    expect(response.body.error.params.issues).toContainEqual({ path: 'taxId', code: 'custom' })
  })

  it('requires a session', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/clients')
      .set('X-Requested-With', 'ledger-hq')
      .send(company)
      .expect(401)
  })
})

describe('GET /clients', () => {
  it('filters by kind', async () => {
    await post('/api/v1/clients', company).expect(201)
    await post('/api/v1/clients', individual).expect(201)

    const companies = await get('/api/v1/clients?kind=COMPANY').expect(200)

    expect(companies.body).toHaveLength(1)
    expect(companies.body[0].kind).toBe('COMPANY')
  })

  it('searches by name and tax number, case-insensitively', async () => {
    await post('/api/v1/clients', company).expect(201)
    await post('/api/v1/clients', individual).expect(201)

    expect((await get('/api/v1/clients?search=padaria').expect(200)).body).toHaveLength(1)
    expect((await get('/api/v1/clients?search=12345').expect(200)).body).toHaveLength(1)
  })

  it('hides archived clients unless asked', async () => {
    const created = await post('/api/v1/clients', company).expect(201)
    await post(`/api/v1/clients/${created.body.id}/archive`, {}).expect(200)

    expect((await get('/api/v1/clients').expect(200)).body).toHaveLength(0)
    expect((await get('/api/v1/clients?includeArchived=true').expect(200)).body).toHaveLength(1)
  })
})

describe('PATCH /clients/:id', () => {
  it('updates mutable fields', async () => {
    const created = await post('/api/v1/clients', company).expect(201)

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/clients/${created.body.id}`)
      .set('Cookie', cookie)
      .set('X-Requested-With', 'ledger-hq')
      .send({ kind: 'COMPANY', phone: '+351 210 000 000' })
      .expect(200)

    expect(response.body.phone).toBe('+351 210 000 000')
    expect(response.body.name).toBe(company.name)
  })

  it('refuses to edit an archived client', async () => {
    const created = await post('/api/v1/clients', company).expect(201)
    await post(`/api/v1/clients/${created.body.id}/archive`, {}).expect(200)

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/clients/${created.body.id}`)
      .set('Cookie', cookie)
      .set('X-Requested-With', 'ledger-hq')
      .send({ kind: 'COMPANY', phone: '+351 210 000 000' })
      .expect(409)

    expect(response.body.error.code).toBe('clients.archived')
  })

  it('returns not found for an unknown id', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/v1/clients/0192f1a0-0000-7000-8000-0000000000ff')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'ledger-hq')
      .send({ kind: 'COMPANY', phone: '1' })
      .expect(404)

    expect(response.body.error.code).toBe('common.not_found')
  })
})

describe('archive and restore', () => {
  it('round-trips', async () => {
    const created = await post('/api/v1/clients', company).expect(201)

    const archived = await post(`/api/v1/clients/${created.body.id}/archive`, {}).expect(200)
    expect(archived.body.archivedAt).toEqual(expect.any(String))

    const restored = await post(`/api/v1/clients/${created.body.id}/restore`, {}).expect(200)
    expect(restored.body.archivedAt).toBeNull()
  })
})
