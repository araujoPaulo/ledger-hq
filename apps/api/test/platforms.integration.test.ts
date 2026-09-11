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

describe('platforms', () => {
  it('creates and lists a platform', async () => {
    await post('/api/v1/platforms', { name: 'Portal das Finanças', authKind: 'PASSWORD' }).expect(201)

    const response = await request(app.getHttpServer()).get('/api/v1/platforms').set('Cookie', cookie).expect(200)
    expect(response.body).toHaveLength(1)
    expect(response.body[0].name).toBe('Portal das Finanças')
  })

  it('rejects a duplicate name', async () => {
    await post('/api/v1/platforms', { name: 'X', authKind: 'PASSWORD' }).expect(201)
    const response = await post('/api/v1/platforms', { name: 'X', authKind: 'PASSWORD' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('platforms.name_taken')
  })

  it('updates a platform', async () => {
    const created = await post('/api/v1/platforms', { name: 'X', authKind: 'PASSWORD' }).expect(201)

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/platforms/${created.body.id}`)
      .set('Cookie', cookie)
      .set('X-Requested-With', 'ledger-hq')
      .send({ authKind: 'PASSWORD_OTP' })
      .expect(200)

    expect(response.body.authKind).toBe('PASSWORD_OTP')
  })

  it('404s on an unknown id', async () => {
    await request(app.getHttpServer()).get('/api/v1/platforms/00000000-0000-7000-8000-000000000099').set('Cookie', cookie).expect(404)
  })
})
