import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app.js'
import { resetDatabase } from './database.js'
import { authenticate } from './authenticate.js'

let app: INestApplication
let cookie: string[]

async function createClient(payload: Record<string, unknown>): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/clients')
    .set('Cookie', cookie)
    .set('X-Requested-With', 'ledger-hq')
    .send(payload)
    .expect(201)

  return response.body.id
}

const companyPayload = (taxId: string, name = 'Padaria Central, Lda.') => ({
  kind: 'COMPANY',
  name,
  taxId,
  accounting: 'ORGANIZED',
  legalForm: 'LDA',
})

const personPayload = (taxId: string, name = 'Maria Santos') => ({
  kind: 'INDIVIDUAL',
  name,
  taxId,
  accounting: 'SIMPLIFIED',
})

function post(path: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(path)
    .set('Cookie', cookie)
    .set('X-Requested-With', 'ledger-hq')
    .send(body)
}

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

describe('POST /employments', () => {
  it('links a person to a company', async () => {
    const employerId = await createClient(companyPayload('501442600'))
    const employeeId = await createClient(personPayload('123456789'))

    const response = await post('/api/v1/employments', {
      employerId,
      employeeId,
      startedOn: '2024-01-15',
      jobTitle: 'Bookkeeper',
    }).expect(201)

    expect(response.body).toMatchObject({
      employerId,
      employerName: 'Padaria Central, Lda.',
      employeeId,
      employeeName: 'Maria Santos',
      startedOn: '2024-01-15',
      endedOn: null,
      jobTitle: 'Bookkeeper',
    })
  })

  it('rejects a person as the employer', async () => {
    const employerId = await createClient(personPayload('123456789'))
    const employeeId = await createClient(personPayload('999999990', 'João Dias'))

    const response = await post('/api/v1/employments', {
      employerId,
      employeeId,
      startedOn: '2024-01-15',
    }).expect(422)

    expect(response.body.error.code).toBe('employment.employer_must_be_company')
  })

  it('rejects a company as the employee', async () => {
    const employerId = await createClient(companyPayload('501442600'))
    const employeeId = await createClient(companyPayload('999999990', 'Outra, Lda.'))

    const response = await post('/api/v1/employments', {
      employerId,
      employeeId,
      startedOn: '2024-01-15',
    }).expect(422)

    expect(response.body.error.code).toBe('employment.employee_must_be_individual')
  })

  it('rejects an overlapping spell for the same pair', async () => {
    const employerId = await createClient(companyPayload('501442600'))
    const employeeId = await createClient(personPayload('123456789'))

    await post('/api/v1/employments', { employerId, employeeId, startedOn: '2024-01-01', endedOn: '2024-12-31' }).expect(201)

    const response = await post('/api/v1/employments', {
      employerId,
      employeeId,
      startedOn: '2024-06-01',
    }).expect(409)

    expect(response.body.error.code).toBe('employment.overlapping_spell')
  })

  it('accepts a consecutive spell for the same pair', async () => {
    const employerId = await createClient(companyPayload('501442600'))
    const employeeId = await createClient(personPayload('123456789'))

    await post('/api/v1/employments', { employerId, employeeId, startedOn: '2024-01-01', endedOn: '2024-12-31' }).expect(201)
    await post('/api/v1/employments', { employerId, employeeId, startedOn: '2025-01-01' }).expect(201)
  })

  it('accepts concurrent spells with different employers', async () => {
    const firstEmployer = await createClient(companyPayload('501442600'))
    const secondEmployer = await createClient(companyPayload('999999990', 'Outra, Lda.'))
    const employeeId = await createClient(personPayload('123456789'))

    await post('/api/v1/employments', { employerId: firstEmployer, employeeId, startedOn: '2024-01-01' }).expect(201)
    await post('/api/v1/employments', { employerId: secondEmployer, employeeId, startedOn: '2024-06-01' }).expect(201)
  })

  it('rejects self-employment at the schema level', async () => {
    const id = await createClient(companyPayload('501442600'))

    const response = await post('/api/v1/employments', { employerId: id, employeeId: id, startedOn: '2024-01-01' }).expect(422)

    expect(response.body.error.params.issues).toContainEqual({
      path: 'employeeId',
      code: 'employment.self_employment',
    })
  })

  it('returns not found for an unknown client', async () => {
    const employerId = await createClient(companyPayload('501442600'))

    await post('/api/v1/employments', {
      employerId,
      employeeId: '0192f1a0-0000-7000-8000-0000000000ff',
      startedOn: '2024-01-01',
    }).expect(404)
  })
})

describe('GET /clients/:id/employments', () => {
  it('lists spells from both sides of the relationship', async () => {
    const employerId = await createClient(companyPayload('501442600'))
    const employeeId = await createClient(personPayload('123456789'))

    await post('/api/v1/employments', { employerId, employeeId, startedOn: '2024-01-15' }).expect(201)

    const fromCompany = await request(app.getHttpServer())
      .get(`/api/v1/clients/${employerId}/employments`)
      .set('Cookie', cookie)
      .expect(200)

    const fromPerson = await request(app.getHttpServer())
      .get(`/api/v1/clients/${employeeId}/employments`)
      .set('Cookie', cookie)
      .expect(200)

    expect(fromCompany.body).toHaveLength(1)
    expect(fromPerson.body).toHaveLength(1)
    expect(fromCompany.body[0].id).toBe(fromPerson.body[0].id)
  })
})

describe('POST /employments/:id/end', () => {
  it('closes an open spell', async () => {
    const employerId = await createClient(companyPayload('501442600'))
    const employeeId = await createClient(personPayload('123456789'))

    const created = await post('/api/v1/employments', { employerId, employeeId, startedOn: '2024-01-15' }).expect(201)

    const ended = await post(`/api/v1/employments/${created.body.id}/end`, { endedOn: '2026-03-31' }).expect(200)

    expect(ended.body.endedOn).toBe('2026-03-31')
  })

  it('rejects an end date before the start date', async () => {
    const employerId = await createClient(companyPayload('501442600'))
    const employeeId = await createClient(personPayload('123456789'))

    const created = await post('/api/v1/employments', { employerId, employeeId, startedOn: '2024-01-15' }).expect(201)

    const response = await post(`/api/v1/employments/${created.body.id}/end`, { endedOn: '2023-01-01' }).expect(422)

    expect(response.body.error.code).toBe('employment.ended_before_started')
  })

  it('rejects an end date that reaches into a later spell for the same pair', async () => {
    const employerId = await createClient(companyPayload('501442600'))
    const employeeId = await createClient(personPayload('123456789'))

    const earlier = await post('/api/v1/employments', {
      employerId,
      employeeId,
      startedOn: '2024-01-01',
      endedOn: '2024-06-30',
    }).expect(201)

    // Consecutive, not overlapping: starts the day after the earlier one ends.
    await post('/api/v1/employments', { employerId, employeeId, startedOn: '2024-07-01' }).expect(201)

    const response = await post(`/api/v1/employments/${earlier.body.id}/end`, { endedOn: '2024-08-01' }).expect(409)

    expect(response.body.error.code).toBe('employment.overlapping_spell')
  })
})
