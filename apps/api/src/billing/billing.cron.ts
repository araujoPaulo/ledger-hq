import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { BillingService } from './billing.service.js'

/**
 * Same shape as ObligationsCron (Phase 2): kept separate from the service
 * so BillingService itself carries zero `@nestjs/schedule` coupling.
 * Registered as a plain provider, not via a second `ScheduleModule.forRoot()`
 * call — see BillingModule's own comment on why.
 */
@Injectable()
export class BillingCron {
  constructor(private readonly billing: BillingService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDailyGeneration(): Promise<void> {
    await this.billing.generateCharges({ asOf: new Date() }, false)
  }
}
