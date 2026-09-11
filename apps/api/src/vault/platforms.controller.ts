import { Body, Controller, Get, Param, Patch, Post, UseGuards, UsePipes } from '@nestjs/common'
import { createPlatformSchema, updatePlatformSchema } from '@ledger-hq/domain'
import type { CreatePlatformInput, UpdatePlatformInput } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PlatformsService } from './platforms.service.js'

@Controller('platforms')
@UseGuards(SessionGuard)
export class PlatformsController {
  constructor(private readonly platforms: PlatformsService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(createPlatformSchema))
  create(@Body() body: CreatePlatformInput) {
    return this.platforms.create(body)
  }

  @Get()
  list() {
    return this.platforms.list()
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.platforms.findOne(id)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updatePlatformSchema)) body: UpdatePlatformInput) {
    return this.platforms.update(id, body)
  }
}
