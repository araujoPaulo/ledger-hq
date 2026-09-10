import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common'
import { fiscalProfileInputSchema } from '@ledger-hq/domain'
import type { FiscalProfileInput } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { FiscalProfilesService } from './fiscal-profiles.service.js'
import type { FiscalProfile } from '../generated/prisma/client.js'

type FiscalProfileResponse = Omit<FiscalProfile, 'startedAt' | 'updatedAt'> & {
  startedAt: string
  updatedAt: string
}

function toResponse(profile: FiscalProfile): FiscalProfileResponse {
  return {
    ...profile,
    startedAt: profile.startedAt.toISOString().slice(0, 10),
    updatedAt: profile.updatedAt.toISOString(),
  }
}

@Controller('clients/:clientId/fiscal-profile')
@UseGuards(SessionGuard)
export class FiscalProfilesController {
  constructor(private readonly profiles: FiscalProfilesService) {}

  @Get()
  async get(@Param('clientId') clientId: string): Promise<FiscalProfileResponse> {
    return toResponse(await this.profiles.get(clientId))
  }

  @Put()
  async put(
    @Param('clientId') clientId: string,
    @Body(new ZodValidationPipe(fiscalProfileInputSchema)) body: FiscalProfileInput,
  ): Promise<FiscalProfileResponse> {
    return toResponse(await this.profiles.upsert(clientId, body))
  }
}
