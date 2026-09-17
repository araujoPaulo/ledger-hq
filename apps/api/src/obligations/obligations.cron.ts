import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ObligationsService } from './obligations.service.js'

/**
 * Kept separate from `ObligationsService` so the service itself carries zero
 * `@nestjs/schedule` coupling and stays a plain, directly-testable class
 * like every other service in this codebase — only this thin wrapper knows
 * it runs on a schedule.
 */
@Injectable()
export class ObligationsCron {
  constructor(private readonly obligations: ObligationsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDailyGeneration(): Promise<void> {
    await this.obligations.generate({ asOf: new Date() }, false)
  }
}
