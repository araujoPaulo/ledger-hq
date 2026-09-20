import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ClientsModule } from '../clients/clients.module.js'
import { PrismaService } from '../common/prisma.service.js'
import { BillingController } from './billing.controller.js'
import { BillingService } from './billing.service.js'
import { BillingCron } from './billing.cron.js'

@Module({
  imports: [AuthModule, ClientsModule],
  controllers: [BillingController],
  providers: [BillingService, BillingCron, PrismaService],
})
export class BillingModule {}
