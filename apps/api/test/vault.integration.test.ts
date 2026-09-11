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

  it('serves the wrapped recovery key without a session', async () => {
    await post('/api/v1/auth/vault-setup', {
      protectedVaultKey: 'AAAA',
      recoveryVaultKey: 'BBBB',
      recoveryAuthHash: 'CCCC',
    }).expect(204)

    const response = await request(app.getHttpServer()).get('/api/v1/auth/vault-recovery-envelope').expect(200)
    expect(response.body).toEqual({ recoveryVaultKey: 'BBBB' })
  })
})

/**
 * Every field the Zod schema validates here must actually be base64
 * (`base64Schema` requires `[A-Za-z0-9+/]+={0,2}`) — plain words like
 * `'AAAA'` happen to pass (they are valid base64 characters), but a
 * hyphenated stand-in like `'the-real-recovery-hash'` would not. The literals
 * below are chosen to read clearly while staying valid: `'dGhlLXJlYWwtcmVjb3ZlcnktaGFzaA=='`
 * is the base64 encoding of the ASCII string `"the-real-recovery-hash"`, and
 * `'TkVXLVNBTFQ='` / `'TkVXLUFVVEgtSEFTSA=='` / `'TkVXLVBST1RFQ1RFRC1LRVk='`
 * are the base64 encodings of `"NEW-SALT"` / `"NEW-AUTH-HASH"` /
 * `"NEW-PROTECTED-KEY"` respectively — so a failing assertion still reads as
 * a recognisable label, not opaque noise.
 */
describe('vault recovery', () => {
  it('rejects an unknown recovery hash', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/vault-recover')
      .set('X-Requested-With', 'ledger-hq')
      .send({ recoveryAuthHash: 'AAAA', kdfSalt: 'BBBB', authHash: 'CCCC', protectedVaultKey: 'DDDD' })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('vault.invalid_recovery_code')
  })

  it('resets login credentials and returns a session when the recovery hash matches', async () => {
    await post('/api/v1/auth/vault-setup', {
      protectedVaultKey: 'AAAA',
      recoveryVaultKey: 'BBBB',
      recoveryAuthHash: 'dGhlLXJlYWwtcmVjb3ZlcnktaGFzaA==',
    }).expect(204)

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/vault-recover')
      .set('X-Requested-With', 'ledger-hq')
      .send({
        recoveryAuthHash: 'dGhlLXJlYWwtcmVjb3ZlcnktaGFzaA==',
        kdfSalt: 'TkVXLVNBTFQ=',
        authHash: 'TkVXLUFVVEgtSEFTSA==',
        protectedVaultKey: 'TkVXLVBST1RFQ1RFRC1LRVk=',
      })

    expect(response.status).toBe(200)
    expect(response.headers['set-cookie']).toBeDefined()

    const envelope = await request(app.getHttpServer())
      .get('/api/v1/auth/vault-envelope')
      .set('Cookie', response.headers['set-cookie'] as unknown as string[])
      .expect(200)
    expect(envelope.body.protectedVaultKey).toBe('TkVXLVBST1RFQ1RFRC1LRVk=')
  })
})
