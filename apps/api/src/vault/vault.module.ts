import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ClientsModule } from '../clients/clients.module.js'
import { PrismaService } from '../common/prisma.service.js'
import { PlatformsController } from './platforms.controller.js'
import { PlatformsService } from './platforms.service.js'
import { CredentialsController } from './credentials.controller.js'
import { CredentialsService } from './credentials.service.js'

@Module({
  imports: [AuthModule, ClientsModule],
  controllers: [PlatformsController, CredentialsController],
  providers: [PlatformsService, CredentialsService, PrismaService],
})
export class VaultModule {}
