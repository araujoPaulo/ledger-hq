import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { createEmploymentSchema, endEmploymentSchema } from '@ledger-hq/domain'
import type { CreateEmploymentInput, EndEmploymentInput } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { EmploymentsService } from './employments.service.js'
import type { EmploymentWithNames } from './employments.service.js'

type EmploymentResponse = {
  id: string
  employerId: string
  employerName: string
  employeeId: string
  employeeName: string
  startedOn: string
  endedOn: string | null
  jobTitle: string | null
  notes: string | null
}

function toResponse(employment: EmploymentWithNames): EmploymentResponse {
  return {
    id: employment.id,
    employerId: employment.employerId,
    employerName: employment.employer.name,
    employeeId: employment.employeeId,
    employeeName: employment.employee.name,
    startedOn: employment.startedOn.toISOString().slice(0, 10),
    endedOn: employment.endedOn ? employment.endedOn.toISOString().slice(0, 10) : null,
    jobTitle: employment.jobTitle,
    notes: employment.notes,
  }
}

@Controller()
@UseGuards(SessionGuard)
export class EmploymentsController {
  constructor(private readonly employments: EmploymentsService) {}

  @Post('employments')
  async create(
    @Body(new ZodValidationPipe(createEmploymentSchema)) body: CreateEmploymentInput,
  ): Promise<EmploymentResponse> {
    return toResponse(await this.employments.create(body))
  }

  @Get('clients/:clientId/employments')
  async listForClient(@Param('clientId') clientId: string): Promise<EmploymentResponse[]> {
    return (await this.employments.listForClient(clientId)).map(toResponse)
  }

  @Post('employments/:id/end')
  @HttpCode(200)
  async end(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(endEmploymentSchema)) body: EndEmploymentInput,
  ): Promise<EmploymentResponse> {
    return toResponse(await this.employments.end(id, body.endedOn))
  }
}
