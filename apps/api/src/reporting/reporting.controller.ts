import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { searchQuerySchema } from '@ledger-hq/domain'
import type { SearchQuery } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { SearchService } from './search.service.js'
import type { SearchHit } from './search.service.js'

@Controller()
@UseGuards(SessionGuard)
export class ReportingController {
  constructor(private readonly search: SearchService) {}

  @Get('search')
  async find(@Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery): Promise<SearchHit[]> {
    const hits = await this.search.search(query.q)
    // `typeRank` exists to order the union and is not part of the contract.
    return hits.map(({ type, id, label, context, href, rank }) => ({ type, id, label, context, href, rank }))
  }
}
