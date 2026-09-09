import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { LoggerModule } from 'nestjs-pino'
import { LOGGER_OPTIONS } from './common/logger.js'
import { validateEnv } from './common/env-validation.js'
import { HealthModule } from './health/health.module.js'
import { AuthModule } from './auth/auth.module.js'
import { CsrfGuard } from './auth/csrf.guard.js'
import { ClientsModule } from './clients/clients.module.js'
import { AuditModule } from './audit/audit.module.js'
import { FiscalProfilesModule } from './fiscal-profiles/fiscal-profiles.module.js'
import { EmploymentsModule } from './employments/employments.module.js'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot(LOGGER_OPTIONS),
    HealthModule,
    AuthModule,
    ClientsModule,
    AuditModule,
    FiscalProfilesModule,
    EmploymentsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: CsrfGuard }],
})
export class AppModule {}
