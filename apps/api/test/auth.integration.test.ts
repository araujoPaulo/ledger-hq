import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { deriveAuthHash, deriveMasterKey, fromBase64, generateSalt, toBase64 } from '@ledger-hq/crypto'
import { createTestApp } from './app.js'
import { getTestPrisma, resetDatabase } from './database.js'

const EMAIL = 'paulo@example.com'
const PASSWORD = 'a long master password'

let app: INestApplication

async function credentialsFor(saltBase64: string): Promise<string> {
  const masterKey = await deriveMasterKey(PASSWORD, fromBase64(saltBase64))
  return toBase64(await deriveAuthHash(masterKey, PASSWORD))
}

async function bootstrap(): Promise<{ kdfSalt: string; authHash: string }> {
  const kdfSalt = toBase64(generateSalt())
  const authHash = await credentialsFor(kdfSalt)

  await request(app.getHttpServer())
    .post('/api/v1/auth/bootstrap')
    .set('X-Requested-With', 'ledger-hq')
    .send({ email: EMAIL, kdfSalt, authHash, locale: 'pt-PT' })
    .expect(201)

  return { kdfSalt, authHash }
}

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
})

describe('bootstrap', () => {
  it('reports that bootstrap is required on an empty database', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/bootstrap-required').expect(200)

    expect(response.body).toEqual({ required: true })
  })

  it('creates the single user and returns a session cookie', async () => {
    const kdfSalt = toBase64(generateSalt())
    const authHash = await credentialsFor(kdfSalt)

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/bootstrap')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: EMAIL, kdfSalt, authHash, locale: 'pt-PT' })
      .expect(201)

    const cookie = response.headers['set-cookie']?.[0] ?? ''
    expect(cookie).toContain('lhq_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('refuses a second bootstrap', async () => {
    await bootstrap()

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/bootstrap')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: 'other@example.com', kdfSalt: toBase64(generateSalt()), authHash: await credentialsFor(toBase64(generateSalt())), locale: 'en-GB' })
      .expect(409)

    expect(response.body).toEqual({ error: { code: 'auth.already_bootstrapped', params: {} } })
  })
})

describe('kdf salt lookup', () => {
  it('returns the stored salt and the agreed parameters', async () => {
    const { kdfSalt } = await bootstrap()

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/kdf')
      .query({ email: EMAIL })
      .expect(200)

    expect(response.body.kdfSalt).toBe(kdfSalt)
    expect(response.body.params).toEqual({
      memorySizeKiB: 65536,
      iterations: 3,
      parallelism: 1,
      hashLengthBytes: 32,
    })
  })

  it('returns a stable decoy salt for an unknown address', async () => {
    const { kdfSalt } = await bootstrap()

    const first = await request(app.getHttpServer()).get('/api/v1/auth/kdf').query({ email: 'nobody@example.com' }).expect(200)
    const second = await request(app.getHttpServer()).get('/api/v1/auth/kdf').query({ email: 'nobody@example.com' }).expect(200)

    expect(first.body.kdfSalt).toBe(second.body.kdfSalt)
    expect(first.body.kdfSalt).not.toBe(kdfSalt)
  })

  it('rejects a query shape it cannot handle instead of crashing', async () => {
    // Express's query parser turns `?email[]=x` into { email: ['x'] } — a
    // plain `.trim()` on that would throw a TypeError and surface as a 500
    // on an authentication endpoint.
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/kdf')
      .query('email[]=x')
      .expect(422)

    expect(response.body).toEqual({
      error: { code: 'common.validation_failed', params: expect.anything() },
    })
  })
})

describe('login', () => {
  it('accepts the correct auth hash', async () => {
    const { authHash } = await bootstrap()

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: EMAIL, authHash })
      .expect(200)

    expect(response.headers['set-cookie']?.[0]).toContain('lhq_session=')
  })

  it('rejects a wrong auth hash with the same code as a wrong address', async () => {
    await bootstrap()

    const wrongHash = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: EMAIL, authHash: toBase64(new Uint8Array(32)) })
      .expect(401)

    const wrongEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: 'nobody@example.com', authHash: toBase64(new Uint8Array(32)) })
      .expect(401)

    expect(wrongHash.body).toEqual({ error: { code: 'auth.invalid_credentials', params: {} } })
    expect(wrongEmail.body).toEqual(wrongHash.body)
  })

  it('accepts a different-case email than the one used to bootstrap', async () => {
    const { authHash } = await bootstrap()

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: EMAIL.toUpperCase(), authHash })
      .expect(200)

    expect(response.headers['set-cookie']?.[0]).toContain('lhq_session=')
  })

  it('rejects a request without the CSRF header', async () => {
    const { authHash } = await bootstrap()

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, authHash })
      .expect(403)

    expect(response.body).toEqual({ error: { code: 'common.forbidden', params: {} } })
  })
})

describe('session', () => {
  it('returns the current user while the cookie is valid', async () => {
    const { authHash } = await bootstrap()

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: EMAIL, authHash })
      .expect(200)

    const cookie = (login.headers['set-cookie'] as unknown as string[] | undefined) ?? []

    const session = await request(app.getHttpServer()).get('/api/v1/auth/session').set('Cookie', cookie).expect(200)

    expect(session.body).toEqual({ id: expect.any(String), email: EMAIL, locale: 'pt-PT' })
  })

  it('rejects a missing cookie', async () => {
    await bootstrap()

    const response = await request(app.getHttpServer()).get('/api/v1/auth/session').expect(401)

    expect(response.body).toEqual({ error: { code: 'auth.session_expired', params: {} } })
  })

  it('invalidates the session on logout', async () => {
    const { authHash } = await bootstrap()

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: EMAIL, authHash })
      .expect(200)

    const cookie = (login.headers['set-cookie'] as unknown as string[] | undefined) ?? []

    await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Cookie', cookie).set('X-Requested-With', 'ledger-hq').expect(204)
    await request(app.getHttpServer()).get('/api/v1/auth/session').set('Cookie', cookie).expect(401)
  })

  it('stores the session token hashed, never in the clear', async () => {
    const { authHash } = await bootstrap()

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: EMAIL, authHash })
      .expect(200)

    const setCookie = login.headers['set-cookie']?.[0] ?? ''
    const rawToken = /lhq_session=([^;]+)/.exec(setCookie)?.[1] ?? ''
    expect(rawToken.length).toBeGreaterThan(0)

    // bootstrap() also creates a session, so look the row up by the expected
    // hash rather than grabbing "any" row: if the raw token were stored
    // instead, this lookup finds nothing and throws.
    const expectedHash = createHash('sha256').update(rawToken).digest('hex')
    const session = await getTestPrisma().session.findUniqueOrThrow({ where: { tokenHash: expectedHash } })

    expect(session.tokenHash).toBe(expectedHash)
    expect(session.tokenHash).not.toBe(rawToken)
  })
})
