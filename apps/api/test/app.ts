import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import { AppModule } from '../src/app.module.js'
import { AppErrorFilter } from '../src/common/app-error.filter.js'
import { notFoundFallback } from '../src/common/not-found-fallback.js'

export async function createTestApp(): Promise<INestApplication> {
  process.env.AUTH_SALT_SECRET ??= 'test-secret'
  process.env.COOKIE_SECURE ??= 'false'

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

  const app = moduleRef.createNestApplication({ logger: false })
  app.setGlobalPrefix('api/v1')
  app.use(cookieParser())
  app.useGlobalFilters(new AppErrorFilter())

  await app.init()
  app.getHttpAdapter().getInstance().use(notFoundFallback)

  return app
}
