import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { AppModule } from './app.module.js'
import { AppErrorFilter } from './common/app-error.filter.js'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })

  app.useLogger(app.get(Logger))
  app.setGlobalPrefix('api/v1')
  app.use(cookieParser())
  app.use(helmet())
  app.useGlobalFilters(new AppErrorFilter())

  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0')
}

void bootstrap()
