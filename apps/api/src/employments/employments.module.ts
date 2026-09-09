import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ClientsModule } from '../clients/clients.module.js'
import { PrismaService } from '../common/prisma.service.js'
import { EmploymentsController } from './employments.controller.js'
import { EmploymentsService } from './employments.service.js'

@Module({
  imports: [AuthModule, ClientsModule],
  controllers: [EmploymentsController],
  providers: [EmploymentsService, PrismaService],
})
export class EmploymentsModule {}
