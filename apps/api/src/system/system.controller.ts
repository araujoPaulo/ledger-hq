import { Controller, Get, UseGuards } from '@nestjs/common'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'
import { SessionGuard } from '../auth/session.guard.js'

type HealthReport = {
  lastBackup: { status: string; occurredAt: string } | null
  consecutiveFailures: number
}

@Controller('system')
@UseGuards(SessionGuard)
export class SystemController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health-report')
  async healthReport(): Promise<HealthReport> {
    const recent = await this.prisma.systemHealth.findMany({
      where: { check: 'backup' },
      orderBy: { occurredAt: 'desc' },
      take: 30,
    })

    const latest = recent[0]
    let consecutiveFailures = 0
    for (const record of recent) {
      if (record.status !== 'FAILED') break
      consecutiveFailures += 1
    }

    return {
      lastBackup: latest ? { status: latest.status, occurredAt: latest.occurredAt.toISOString() } : null,
      consecutiveFailures,
    }
  }
}
