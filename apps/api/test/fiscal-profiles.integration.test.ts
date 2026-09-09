import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app.js'
import { getTestPrisma, resetDatabase } from './database.js'
import { authenticate } from './authenticate.js'

const prisma = getTestPrisma()

const companyProfile = {
  hasOpenActivity: true,
  vatRegime: 'QUARTERLY',
  incomeTax: 'CIT',
  hasEmployees: true,
  hasWithholding: true,
  isVatCashBasis: false,
  startedAt: '2020-01-01',
}

const employeeProfile = {
  hasOpenActivity: false,
  vatRegime: 'NOT_APPLICABLE',
  incomeTax: 'PIT_EMPLOYMENT_ONLY',
  hasEmployees: false,
  hasWithholding: false,
  isVatCashBasis: false,
  startedAt: '2021-03-01',
}

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

function putProfile(clientId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .put(`/api/v1/clients/${clientId}/fiscal-profile`)
    .set('Cookie', cookie)
    .set('X-Requested-With', 'ledger-hq')
    .send(body)
}

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

describe('PUT /clients/:id/fiscal-profile', () => {
  it('stores a company profile', async () => {
    const clientId = await createClient({
      kind: 'COMPANY',
      name: 'Padaria Central, Lda.',
      taxId: '501442600',
      accounting: 'ORGANIZED',
      legalForm: 'LDA',
    })

    const response = await putProfile(clientId, companyProfile).expect(200)

    expect(response.body).toMatchObject(companyProfile)
  })

  it('stores a profile for an employee with no activity of their own', async () => {
    const clientId = await createClient({
      kind: 'INDIVIDUAL',
      name: 'Maria Santos',
      taxId: '123456789',
      accounting: 'SIMPLIFIED',
    })

    await putProfile(clientId, employeeProfile).expect(200)
  })

  it('rejects corporate income tax on an individual', async () => {
    const clientId = await createClient({
      kind: 'INDIVIDUAL',
      name: 'Maria Santos',
      taxId: '123456789',
      accounting: 'SIMPLIFIED',
    })

    const response = await putProfile(clientId, { ...employeeProfile, incomeTax: 'CIT' }).expect(422)

    expect(response.body.error.params.issues).toContainEqual({
      path: 'incomeTax',
      code: 'fiscal_profile.income_tax_incompatible_with_kind',
    })
  })

  it('reports every consistency violation at once', async () => {
    const clientId = await createClient({
      kind: 'INDIVIDUAL',
      name: 'Maria Santos',
      taxId: '123456789',
      accounting: 'SIMPLIFIED',
    })

    const response = await putProfile(clientId, {
      ...employeeProfile,
      incomeTax: 'CIT',
      hasEmployees: true,
    }).expect(422)

    expect(response.body.error.params.issues).toHaveLength(2)
  })

  it('is idempotent and overwrites on a second call', async () => {
    const clientId = await createClient({
      kind: 'COMPANY',
      name: 'Padaria Central, Lda.',
      taxId: '501442600',
      accounting: 'ORGANIZED',
      legalForm: 'LDA',
    })

    await putProfile(clientId, companyProfile).expect(200)
    const updated = await putProfile(clientId, { ...companyProfile, vatRegime: 'MONTHLY' }).expect(200)

    expect(updated.body.vatRegime).toBe('MONTHLY')
  })

  it('writes an audit event recording the change', async () => {
    const clientId = await createClient({
      kind: 'COMPANY',
      name: 'Padaria Central, Lda.',
      taxId: '501442600',
      accounting: 'ORGANIZED',
      legalForm: 'LDA',
    })

    await putProfile(clientId, companyProfile).expect(200)
    await putProfile(clientId, { ...companyProfile, vatRegime: 'MONTHLY' }).expect(200)

    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'FiscalProfile', entityId: clientId },
      orderBy: { occurredAt: 'asc' },
    })

    expect(events).toHaveLength(2)
    expect(events[1]?.action).toBe('fiscal_profile.changed')
    expect(events[1]?.metadata).toMatchObject({
      changed: { vatRegime: { from: 'QUARTERLY', to: 'MONTHLY' } },
    })
  })

  it('returns not found for an unknown client', async () => {
    await putProfile('0192f1a0-0000-7000-8000-0000000000ff', companyProfile).expect(404)
  })
})

describe('GET /clients/:id/fiscal-profile', () => {
  it('returns 404 before a profile is set', async () => {
    const clientId = await createClient({
      kind: 'COMPANY',
      name: 'Padaria Central, Lda.',
      taxId: '501442600',
      accounting: 'ORGANIZED',
      legalForm: 'LDA',
    })

    await request(app.getHttpServer())
      .get(`/api/v1/clients/${clientId}/fiscal-profile`)
      .set('Cookie', cookie)
      .expect(404)
  })
})
