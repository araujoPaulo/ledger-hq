import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { PrismaService } from '../common/prisma.service.js'
import { ClientsController } from './clients.controller.js'
import { ClientsService } from './clients.service.js'

@Module({
  imports: [AuthModule],
  controllers: [ClientsController],
  providers: [ClientsService, PrismaService],
  exports: [ClientsService],
})
export class ClientsModule {}
