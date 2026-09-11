import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app.js'
import { getTestPrisma, resetDatabase } from './database.js'
import { authenticate } from './authenticate.js'

let app: INestApplication
let cookie: string[]

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

describe('audit events', () => {
  it('records a credential-reveal event', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/vault/audit-events')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'ledger-hq')
      .send({ entityType: 'credential', entityId: 'c1', action: 'credential.revealed', metadata: {} })
      .expect(204)

    const events = await getTestPrisma().auditEvent.findMany()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ entityType: 'credential', entityId: 'c1', action: 'credential.revealed' })
  })

  it('rejects without a session', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/vault/audit-events')
      .set('X-Requested-With', 'ledger-hq')
      .send({ entityType: 'credential', entityId: 'c1', action: 'credential.revealed', metadata: {} })
      .expect(401)
  })
})
