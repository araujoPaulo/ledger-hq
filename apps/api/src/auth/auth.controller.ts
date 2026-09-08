import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards, UsePipes } from '@nestjs/common'
import type { Request, Response } from 'express'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ConfigService } from '@nestjs/config'
import { bootstrapSchema, loginSchema } from '@ledger-hq/domain'
import type { BootstrapInput, LoginInput } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- AuthService is constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { AuthService, type SessionUser } from './auth.service.js'
import { SESSION_COOKIE, SessionGuard } from './session.guard.js'
import { CurrentUser } from './current-user.decorator.js'

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Get('bootstrap-required')
  async bootstrapRequired(): Promise<{ required: boolean }> {
    return { required: await this.auth.bootstrapRequired() }
  }

  @Get('kdf')
  async kdf(@Query('email') email: string) {
    return this.auth.kdfSaltFor((email ?? '').trim())
  }

  @Post('bootstrap')
  @UsePipes(new ZodValidationPipe(bootstrapSchema))
  async bootstrap(@Body() body: BootstrapInput, @Res({ passthrough: true }) response: Response): Promise<void> {
    this.setSessionCookie(response, await this.auth.bootstrap(body))
  }

  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() body: LoginInput, @Res({ passthrough: true }) response: Response): Promise<void> {
    this.setSessionCookie(response, await this.auth.login(body))
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const token = request.cookies?.[SESSION_COOKIE]
    if (typeof token === 'string') await this.auth.revokeSession(token)

    response.clearCookie(SESSION_COOKIE, { path: '/' })
  }

  @Get('session')
  @UseGuards(SessionGuard)
  session(@CurrentUser() user: SessionUser): SessionUser {
    return user
  }

  private setSessionCookie(response: Response, token: string): void {
    const ttlDays = Number(this.config.get<string>('SESSION_TTL_DAYS') ?? '30')

    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.get<string>('COOKIE_SECURE') !== 'false',
      path: '/',
      maxAge: ttlDays * 24 * 60 * 60 * 1000,
    })
  }
}
