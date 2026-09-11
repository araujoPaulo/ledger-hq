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

describe('vault envelope', () => {
  it('reports not set up before any setup call', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/vault-envelope').set('Cookie', cookie).expect(200)
    expect(response.body).toEqual({ protectedVaultKey: null, setUpAt: null })
  })

  it('stores the envelope on setup and reports it back', async () => {
    await post('/api/v1/auth/vault-setup', {
      protectedVaultKey: 'AAAA',
      recoveryVaultKey: 'BBBB',
      recoveryAuthHash: 'CCCC',
    }).expect(204)

    const response = await request(app.getHttpServer()).get('/api/v1/auth/vault-envelope').set('Cookie', cookie).expect(200)
    expect(response.body.protectedVaultKey).toBe('AAAA')
    expect(response.body.setUpAt).not.toBeNull()
  })

  it('refuses to set up the vault twice', async () => {
    await post('/api/v1/auth/vault-setup', {
      protectedVaultKey: 'AAAA',
      recoveryVaultKey: 'BBBB',
      recoveryAuthHash: 'CCCC',
    }).expect(204)

    const response = await post('/api/v1/auth/vault-setup', {
      protectedVaultKey: 'DDDD',
      recoveryVaultKey: 'EEEE',
      recoveryAuthHash: 'FFFF',
    })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('vault.already_set_up')
  })

  it('rejects vault-envelope without a session', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/vault-envelope').expect(401)
  })
})
