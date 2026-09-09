import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { AuditModule } from '../audit/audit.module.js'
import { ClientsModule } from '../clients/clients.module.js'
import { PrismaService } from '../common/prisma.service.js'
import { FiscalProfilesController } from './fiscal-profiles.controller.js'
import { FiscalProfilesService } from './fiscal-profiles.service.js'

@Module({
  imports: [AuthModule, AuditModule, ClientsModule],
  controllers: [FiscalProfilesController],
  providers: [FiscalProfilesService, PrismaService],
})
export class FiscalProfilesModule {}
