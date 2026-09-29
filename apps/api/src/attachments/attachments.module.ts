import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ObligationsModule } from '../obligations/obligations.module.js'
import { PrismaService } from '../common/prisma.service.js'
import { AttachmentsController } from './attachments.controller.js'
import { AttachmentsService } from './attachments.service.js'
import { FileStorageService } from './file-storage.service.js'

@Module({
  imports: [AuthModule, ObligationsModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, FileStorageService, PrismaService],
})
export class AttachmentsModule {}
