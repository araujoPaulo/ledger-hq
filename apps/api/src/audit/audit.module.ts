import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { PrismaService } from '../common/prisma.service.js'
import { AuditController } from './audit.controller.js'
import { AuditService } from './audit.service.js'

@Module({
  imports: [AuthModule],
  controllers: [AuditController],
  providers: [AuditService, PrismaService],
  exports: [AuditService],
})
export class AuditModule {}
