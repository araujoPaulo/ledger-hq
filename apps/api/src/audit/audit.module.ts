import { Module } from '@nestjs/common'
import { PrismaService } from '../common/prisma.service.js'
import { AuditService } from './audit.service.js'

@Module({ providers: [AuditService, PrismaService], exports: [AuditService] })
export class AuditModule {}
