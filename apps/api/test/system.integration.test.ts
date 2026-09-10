import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { uuidv7 } from 'uuidv7'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app.js'
import { getTestPrisma, resetDatabase } from './database.js'
import { authenticate } from './authenticate.js'

const prisma = getTestPrisma()

let app: INestApplication
let cookie: string[]

async function recordBackup(status: string, minutesAgo: number): Promise<void> {
  await prisma.systemHealth.create({
    data: {
      id: uuidv7(),
      check: 'backup',
      status,
      occurredAt: new Date(Date.now() - minutesAgo * 60_000),
    },
  })
}

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

describe('GET /system/health-report', () => {
  it('reports no backup on a fresh installation', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/system/health-report')
      .set('Cookie', cookie)
      .expect(200)

    expect(response.body).toEqual({ lastBackup: null, consecutiveFailures: 0 })
  })

  it('returns the most recent backup outcome', async () => {
    await recordBackup('OK', 600)
    await recordBackup('FAILED', 60)

    const response = await request(app.getHttpServer())
      .get('/api/v1/system/health-report')
      .set('Cookie', cookie)
      .expect(200)

    expect(response.body.lastBackup.status).toBe('FAILED')
    expect(response.body.consecutiveFailures).toBe(1)
  })

  it('counts consecutive failures and stops at the last success', async () => {
    await recordBackup('OK', 5000)
    await recordBackup('FAILED', 3000)
    await recordBackup('FAILED', 2000)
    await recordBackup('FAILED', 1000)

    const response = await request(app.getHttpServer())
      .get('/api/v1/system/health-report')
      .set('Cookie', cookie)
      .expect(200)

    expect(response.body.consecutiveFailures).toBe(3)
  })

  it('requires a session', async () => {
    await request(app.getHttpServer()).get('/api/v1/system/health-report').expect(401)
  })
})
