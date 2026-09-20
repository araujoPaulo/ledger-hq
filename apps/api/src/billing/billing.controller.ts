import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import {
  createAdHocChargeSchema,
  createRetainerPlanSchema,
  generateChargesBodySchema,
  generateChargesQuerySchema,
  proposeAllocationSchema,
  recordPaymentSchema,
  renewRetainerPlanSchema,
  writeOffChargeSchema,
} from '@ledger-hq/domain'
import type {
  CreateAdHocChargeInput,
  CreateRetainerPlanInput,
  GenerateChargesInput,
  GenerateChargesQuery,
  ProposeAllocationInput,
  RecordPaymentInput,
  RenewRetainerPlanInput,
  WriteOffChargeInput,
} from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { BillingService } from './billing.service.js'
import type { GenerateChargesResult } from './billing.service.js'

@Controller('billing')
@UseGuards(SessionGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('generate-charges')
  async generateCharges(
    @Query(new ZodValidationPipe(generateChargesQuerySchema)) query: GenerateChargesQuery,
    @Body(new ZodValidationPipe(generateChargesBodySchema)) body: GenerateChargesInput,
  ): Promise<GenerateChargesResult> {
    const asOf = body.asOf ? new Date(`${body.asOf}T00:00:00Z`) : new Date()
    // Same safe-default ruling as the obligation generator (Phase 2): an
    // omitted or malformed dryRun never applies.
    return this.billing.generateCharges(
      { asOf, ...(body.clientId !== undefined ? { clientId: body.clientId } : {}) },
      query.dryRun !== 'false',
    )
  }

  @Post('clients/:clientId/retainer-plan')
  async createRetainerPlan(
    @Param('clientId') clientId: string,
    @Body(new ZodValidationPipe(createRetainerPlanSchema)) body: CreateRetainerPlanInput,
  ) {
    return this.billing.createRetainerPlan(clientId, body)
  }

  @Post('clients/:clientId/retainer-plan/renew')
  async renewRetainerPlan(
    @Param('clientId') clientId: string,
    @Body(new ZodValidationPipe(renewRetainerPlanSchema)) body: RenewRetainerPlanInput,
  ) {
    return this.billing.renewRetainerPlan(clientId, body)
  }

  // Nest's default reply path treats a `null` return value as "no body" (it calls
  // `response.send()` with no argument), which would send an empty 200 rather than the
  // JSON literal `null` the web client expects. Writing the response directly is the
  // one deviation from the sibling handlers above, forced by that framework behavior.
  @Get('clients/:clientId/retainer-plan')
  async getCurrentRetainerPlan(@Param('clientId') clientId: string, @Res() response: Response): Promise<void> {
    const plan = await this.billing.getCurrentRetainerPlan(clientId)
    response.json(plan)
  }

  @Post('payments/propose-allocation')
  async proposeAllocation(@Body(new ZodValidationPipe(proposeAllocationSchema)) body: ProposeAllocationInput) {
    return this.billing.proposeAllocationForClient(body.clientId, body.amountCents)
  }

  @Post('payments')
  async recordPayment(@Body(new ZodValidationPipe(recordPaymentSchema)) body: RecordPaymentInput) {
    return this.billing.recordPayment(body)
  }

  @Post('charges')
  async createAdHocCharge(@Body(new ZodValidationPipe(createAdHocChargeSchema)) body: CreateAdHocChargeInput) {
    return this.billing.createAdHocCharge(body)
  }

  @Patch('charges/:id/write-off')
  async writeOffCharge(@Param('id') id: string, @Body(new ZodValidationPipe(writeOffChargeSchema)) body: WriteOffChargeInput) {
    return this.billing.writeOffCharge(id, body.reason)
  }

  @Get('receivables')
  async receivables() {
    return this.billing.getReceivables(new Date())
  }

  @Get('current-month')
  async currentMonth() {
    return this.billing.getCurrentMonth(new Date())
  }

  @Get('clients/:clientId/ledger')
  async ledger(@Param('clientId') clientId: string) {
    return this.billing.getClientLedger(clientId)
  }
}
