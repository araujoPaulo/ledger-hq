import { Body, Controller, HttpCode, Post, UseGuards, UsePipes } from '@nestjs/common'
import { createAuditEventSchema } from '@ledger-hq/domain'
import type { CreateAuditEventInput } from '@ledger-hq/domain'
import type { Prisma } from '../generated/prisma/client.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { AuditService } from './audit.service.js'

@Controller('vault/audit-events')
@UseGuards(SessionGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Post()
  @HttpCode(204)
  @UsePipes(new ZodValidationPipe(createAuditEventSchema))
  async record(@Body() body: CreateAuditEventInput): Promise<void> {
    // Zod's `.record(z.string(), z.unknown())` is already JSON-safe (it came
    // through `JSON.parse`'d request body), but structurally TS can't verify
    // `unknown` recursively satisfies Prisma's `InputJsonValue` — hence the cast.
    await this.audit.record({ ...body, metadata: body.metadata as Prisma.InputJsonValue })
  }
}
