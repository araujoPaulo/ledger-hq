import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { PrismaService } from '../common/prisma.service.js'
import { ReportingController } from './reporting.controller.js'
import { SearchService } from './search.service.js'
import { ReportsService } from './reports.service.js'

/**
 * The cross-module read layer `docs/architecture.md` reserved: `clients` is
 * the core and `vault`/`obligations`/`billing` never import one another, so
 * a view spanning two of them belongs here. It imports `auth` for
 * `SessionGuard` and nothing else, reads other modules' tables through
 * `$queryRaw`, calls no sibling service, and no sibling imports it.
 */
@Module({
  imports: [AuthModule],
  controllers: [ReportingController],
  providers: [SearchService, ReportsService, PrismaService],
})
export class ReportingModule {}
