import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { PrismaService } from '../common/prisma.service.js'
import { SystemController } from './system.controller.js'

@Module({ imports: [AuthModule], controllers: [SystemController], providers: [PrismaService] })
export class SystemModule {}
