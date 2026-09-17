import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { AppError, OBLIGATION_STATUS_VALUES } from '@ledger-hq/domain'
import {
  createAdHocObligationSchema,
  generateObligationsBodySchema,
  generateObligationsQuerySchema,
  listObligationsQuerySchema,
  patchObligationSchema,
} from '@ledger-hq/domain'
import type {
  CreateAdHocObligationInput,
  GenerateObligationsInput,
  GenerateObligationsQuery,
  ListObligationsQuery,
  ObligationStatus,
  PatchObligationInput,
} from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ObligationsService } from './obligations.service.js'
import type { GenerateResult, ObligationWithDefinition } from './obligations.service.js'

type ObligationResponse = {
  id: string
  clientId: string
  clientName: string
  definitionCode: string
  definitionName: string
  authority: string
  periodLabel: string
  dueDate: string
  dueDateOverridden: boolean
  status: string
  completedAt: string | null
  reference: string | null
  amountCents: number | null
  notes: string | null
}

function toResponse(instance: ObligationWithDefinition): ObligationResponse {
  return {
    id: instance.id,
    clientId: instance.clientId,
    clientName: instance.client.name,
    definitionCode: instance.definitionCode,
    definitionName: instance.definition.name,
    authority: instance.definition.authority,
    periodLabel: instance.periodLabel,
    dueDate: instance.dueDate.toISOString().slice(0, 10),
    dueDateOverridden: instance.dueDateOverridden,
    status: instance.status,
    completedAt: instance.completedAt?.toISOString() ?? null,
    reference: instance.reference,
    amountCents: instance.amountCents,
    notes: instance.notes,
  }
}

function parseStatuses(raw: string): ObligationStatus[] {
  const values = raw.split(',').map((value) => value.trim())
  for (const value of values) {
    if (!OBLIGATION_STATUS_VALUES.includes(value as ObligationStatus)) {
      throw new AppError('common.validation_failed', { issues: [{ path: 'status', code: 'common.validation_failed' }] }, 422)
    }
  }
  return values as ObligationStatus[]
}

@Controller()
@UseGuards(SessionGuard)
export class ObligationsController {
  constructor(private readonly obligations: ObligationsService) {}

  @Get('obligations')
  async list(
    @Query(new ZodValidationPipe(listObligationsQuerySchema)) query: ListObligationsQuery,
  ): Promise<ObligationResponse[]> {
    return (
      await this.obligations.list({
        ...(query.clientId !== undefined ? { clientId: query.clientId } : {}),
        ...(query.status !== undefined ? { status: parseStatuses(query.status) } : {}),
      })
    ).map(toResponse)
  }

  @Post('obligations/generate')
  async generate(
    @Query(new ZodValidationPipe(generateObligationsQuerySchema)) query: GenerateObligationsQuery,
    @Body(new ZodValidationPipe(generateObligationsBodySchema)) body: GenerateObligationsInput,
  ): Promise<GenerateResult> {
    const asOf = body.asOf ? new Date(`${body.asOf}T00:00:00Z`) : new Date()
    // Defaults to the safe option: an omitted or malformed `dryRun` never
    // applies. Only an explicit `dryRun=false` writes anything — the web
    // client (Task 13) always sends one explicitly; this default only
    // matters for a raw API call that forgets the query param.
    return this.obligations.generate(
      { asOf, ...(body.clientId !== undefined ? { clientId: body.clientId } : {}) },
      query.dryRun !== 'false',
    )
  }

  @Patch('obligations/:id')
  async patch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchObligationSchema)) body: PatchObligationInput,
  ): Promise<ObligationResponse> {
    return toResponse(await this.obligations.patch(id, body))
  }

  @Post('obligations')
  async createAdHoc(
    @Body(new ZodValidationPipe(createAdHocObligationSchema)) body: CreateAdHocObligationInput,
  ): Promise<ObligationResponse> {
    return toResponse(await this.obligations.createAdHoc(body))
  }
}
