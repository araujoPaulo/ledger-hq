import { Injectable } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client.js'
import { uuidv7 } from 'uuidv7'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'

export type AuditInput = {
  entityType: string
  entityId: string
  /** A machine code, never prose. The frontend translates it. */
  action: string
  metadata: Prisma.InputJsonValue
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    await this.prisma.auditEvent.create({ data: { id: uuidv7(), ...input } })
  }
}
