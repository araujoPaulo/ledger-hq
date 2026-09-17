import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AuthModule } from '../auth/auth.module.js'
import { ClientsModule } from '../clients/clients.module.js'
import { PrismaService } from '../common/prisma.service.js'
import { ObligationsController } from './obligations.controller.js'
import { ObligationsService } from './obligations.service.js'
import { ObligationsCron } from './obligations.cron.js'

@Module({
  imports: [AuthModule, ClientsModule, ScheduleModule.forRoot()],
  controllers: [ObligationsController],
  providers: [ObligationsService, ObligationsCron, PrismaService],
})
export class ObligationsModule {}
