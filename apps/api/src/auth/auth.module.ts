import { Module } from '@nestjs/common'
import { PrismaService } from '../common/prisma.service.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { SessionGuard } from './session.guard.js'

@Module({
  controllers: [AuthController],
  providers: [AuthService, PrismaService, SessionGuard],
  exports: [AuthService, SessionGuard, PrismaService],
})
export class AuthModule {}
