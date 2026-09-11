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

function post(path: string, body: Record<string, unknown>) {
  return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq').send(body)
}

async function setUpVault() {
  await post('/api/v1/auth/vault-setup', {
    protectedVaultKey: 'AAAA',
    recoveryVaultKey: 'BBBB',
    recoveryAuthHash: 'CCCC',
  }).expect(204)
}

async function createClient() {
  const response = await post('/api/v1/clients', {
    kind: 'COMPANY',
    name: 'Padaria Central, Lda.',
    taxId: '501442600',
    accounting: 'ORGANIZED',
    legalForm: 'LDA',
  }).expect(201)
  return response.body.id as string
}

async function createPlatform() {
  const response = await post('/api/v1/platforms', { name: 'Portal das Finanças', authKind: 'PASSWORD' }).expect(201)
  return response.body.id as string
}

describe('credentials', () => {
  it('refuses to create a credential before the vault is set up', async () => {
    const clientId = await createClient()
    const platformId = await createPlatform()

    const response = await post('/api/v1/credentials', { clientId, platformId, label: 'x', ciphertext: 'AAAA', iv: 'AAAA' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('vault.not_set_up')
  })

  it('creates a credential and lists it for the client', async () => {
    await setUpVault()
    const clientId = await createClient()
    const platformId = await createPlatform()

    await post('/api/v1/credentials', { clientId, platformId, label: 'Acesso principal', ciphertext: 'AAAA', iv: 'BBBB' }).expect(201)

    const response = await request(app.getHttpServer())
      .get(`/api/v1/clients/${clientId}/credentials`)
      .set('Cookie', cookie)
      .expect(200)

    expect(response.body).toHaveLength(1)
    expect(response.body[0]).toMatchObject({ label: 'Acesso principal', ciphertext: 'AAAA', iv: 'BBBB' })
  })

  it('rejects a duplicate label for the same client and platform', async () => {
    await setUpVault()
    const clientId = await createClient()
    const platformId = await createPlatform()
    const payload = { clientId, platformId, label: 'x', ciphertext: 'AAAA', iv: 'AAAA' }

    await post('/api/v1/credentials', payload).expect(201)
    const response = await post('/api/v1/credentials', payload)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('credentials.label_taken')
  })

  it('rotates a credential and keeps the previous version in history', async () => {
    await setUpVault()
    const clientId = await createClient()
    const platformId = await createPlatform()

    const created = await post('/api/v1/credentials', { clientId, platformId, label: 'x', ciphertext: 'AAAA', iv: 'AAAA' }).expect(201)

    await post(`/api/v1/credentials/${created.body.id}/rotate`, { ciphertext: 'ZZZZ', iv: 'YYYY' }).expect(201)

    const versions = await request(app.getHttpServer())
      .get(`/api/v1/credentials/${created.body.id}/versions`)
      .set('Cookie', cookie)
      .expect(200)
    expect(versions.body).toHaveLength(2)
    expect(versions.body[0].ciphertext).toBe('ZZZZ')
    expect(versions.body[1].ciphertext).toBe('AAAA')
  })

  it('syncs only credentials updated after the given cursor', async () => {
    await setUpVault()
    const clientId = await createClient()
    const platformId = await createPlatform()
    await post('/api/v1/credentials', { clientId, platformId, label: 'old', ciphertext: 'AAAA', iv: 'AAAA' }).expect(201)

    const cursor = new Date().toISOString()
    await post('/api/v1/credentials', { clientId, platformId, label: 'new', ciphertext: 'BBBB', iv: 'BBBB' }).expect(201)

    const response = await request(app.getHttpServer())
      .get(`/api/v1/vault/sync?since=${encodeURIComponent(cursor)}`)
      .set('Cookie', cookie)
      .expect(200)

    expect(response.body).toHaveLength(1)
    expect(response.body[0].label).toBe('new')
  })
})
