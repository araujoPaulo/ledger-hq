import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app.js'
import { resetDatabase } from './database.js'

let app: INestApplication

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
})

/**
 * Only AppError is thrown by our own code. These cases exercise the two
 * kinds of failure Nest itself can produce, to prove neither ever renders
 * the framework's default prose body.
 */
describe('errors outside AppError', () => {
  it('answers an unmatched route with a code-only envelope instead of the default HTML page', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404)

    expect(response.type).toBe('application/json')
    expect(response.body).toEqual({ error: { code: 'common.not_found', params: {} } })
  })

  it('answers a malformed JSON body with a code-only envelope instead of the parser message', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'ledger-hq')
      .set('Content-Type', 'application/json')
      .send('{not valid json')
      .expect(400)

    expect(response.body).toEqual({ error: { code: 'common.validation_failed', params: {} } })
  })
})
