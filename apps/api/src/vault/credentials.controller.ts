import { Body, Controller, Get, Param, Post, Query, UseGuards, UsePipes } from '@nestjs/common'
import { createCredentialSchema, rotateCredentialSchema, syncCredentialsQuerySchema } from '@ledger-hq/domain'
import type { CreateCredentialInput, RotateCredentialInput, SyncCredentialsQuery } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { CredentialsService } from './credentials.service.js'
import type { CredentialWithVersions } from './credentials.service.js'
import type { CredentialVersion } from '../generated/prisma/client.js'

type CredentialResponse = {
  id: string
  clientId: string
  platformId: string
  label: string
  updatedAt: string
  ciphertext: string
  iv: string
}

type VersionResponse = { id: string; createdAt: string; ciphertext: string; iv: string }

function toResponse(credential: CredentialWithVersions): CredentialResponse {
  // `versions` always carries at least one entry: `create` and `rotate` both
  // write a version alongside the credential row and none is ever deleted,
  // so this index is safe despite `noUncheckedIndexedAccess`.
  const latest = credential.versions[0]!
  return {
    id: credential.id,
    clientId: credential.clientId,
    platformId: credential.platformId,
    label: credential.label,
    updatedAt: credential.updatedAt.toISOString(),
    ciphertext: Buffer.from(latest.ciphertext).toString('base64'),
    iv: Buffer.from(latest.iv).toString('base64'),
  }
}

function toVersionResponse(version: CredentialVersion): VersionResponse {
  return {
    id: version.id,
    createdAt: version.createdAt.toISOString(),
    ciphertext: Buffer.from(version.ciphertext).toString('base64'),
    iv: Buffer.from(version.iv).toString('base64'),
  }
}

@Controller()
@UseGuards(SessionGuard)
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Post('credentials')
  async create(@Body(new ZodValidationPipe(createCredentialSchema)) body: CreateCredentialInput): Promise<CredentialResponse> {
    return toResponse(await this.credentials.create(body))
  }

  @Get('clients/:clientId/credentials')
  async listForClient(@Param('clientId') clientId: string): Promise<CredentialResponse[]> {
    return (await this.credentials.listForClient(clientId)).map(toResponse)
  }

  @Post('credentials/:id/rotate')
  async rotate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rotateCredentialSchema)) body: RotateCredentialInput,
  ): Promise<CredentialResponse> {
    return toResponse(await this.credentials.rotate(id, body))
  }

  @Get('credentials/:id/versions')
  async listVersions(@Param('id') id: string): Promise<VersionResponse[]> {
    return (await this.credentials.listVersions(id)).map(toVersionResponse)
  }

  @Get('vault/sync')
  @UsePipes(new ZodValidationPipe(syncCredentialsQuerySchema))
  async sync(@Query() query: SyncCredentialsQuery): Promise<CredentialResponse[]> {
    return (await this.credentials.sync(query.since ? new Date(query.since) : null)).map(toResponse)
  }
}
