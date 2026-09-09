import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { createClientSchema, updateClientSchema } from '@ledger-hq/domain'
import type { CreateClientInput, UpdateClientInput } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ClientsService } from './clients.service.js'
import { toClientResponse } from './client.mapper.js'
import type { ClientResponse } from './client.mapper.js'

@Controller('clients')
@UseGuards(SessionGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  async list(
    @Query('kind') kind?: 'COMPANY' | 'INDIVIDUAL',
    @Query('search') search?: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<ClientResponse[]> {
    const found = await this.clients.list({
      ...(kind ? { kind } : {}),
      ...(search ? { search } : {}),
      includeArchived: includeArchived === 'true',
    })

    return found.map(toClientResponse)
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createClientSchema)) body: CreateClientInput,
  ): Promise<ClientResponse> {
    return toClientResponse(await this.clients.create(body))
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ClientResponse> {
    return toClientResponse(await this.clients.findOne(id))
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateClientSchema)) body: UpdateClientInput,
  ): Promise<ClientResponse> {
    return toClientResponse(await this.clients.update(id, body))
  }

  @Post(':id/archive')
  @HttpCode(200)
  async archive(@Param('id') id: string): Promise<ClientResponse> {
    return toClientResponse(await this.clients.archive(id))
  }

  @Post(':id/restore')
  @HttpCode(200)
  async restore(@Param('id') id: string): Promise<ClientResponse> {
    return toClientResponse(await this.clients.restore(id))
  }
}
