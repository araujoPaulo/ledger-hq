import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { atRiskQuerySchema, periodSummaryQuerySchema, searchQuerySchema } from '@ledger-hq/domain'
import type { AtRiskQuery, PeriodSummaryQuery, SearchQuery } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { SearchService } from './search.service.js'
import type { SearchHit } from './search.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ReportsService } from './reports.service.js'
import type { AtRiskRow, PeriodSummary } from './reports.service.js'

@Controller()
@UseGuards(SessionGuard)
export class ReportingController {
  constructor(
    private readonly search: SearchService,
    private readonly reports: ReportsService,
  ) {}

  @Get('search')
  async find(@Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery): Promise<SearchHit[]> {
    const hits = await this.search.search(query.q)
    // `typeRank` exists to order the union and is not part of the contract.
    return hits.map(({ type, id, label, context, href, rank }) => ({ type, id, label, context, href, rank }))
  }

  @Get('reporting/at-risk')
  async atRisk(@Query(new ZodValidationPipe(atRiskQuerySchema)) query: AtRiskQuery): Promise<AtRiskRow[]> {
    const asOf = query.asOf === undefined ? new Date() : new Date(`${query.asOf}T00:00:00Z`)
    return this.reports.atRisk(asOf)
  }

  @Get('reporting/period-summary')
  async periodSummary(
    @Query(new ZodValidationPipe(periodSummaryQuerySchema)) query: PeriodSummaryQuery,
  ): Promise<PeriodSummary> {
    return this.reports.periodSummary(new Date(`${query.from}T00:00:00Z`), new Date(`${query.to}T00:00:00Z`))
  }
}
