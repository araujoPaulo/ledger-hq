import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards, UsePipes } from '@nestjs/common'
import type { Request, Response } from 'express'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ConfigService } from '@nestjs/config'
import { bootstrapSchema, kdfQuerySchema, loginSchema, recoverVaultSchema, setUpVaultSchema } from '@ledger-hq/domain'
import type { BootstrapInput, KdfQuery, LoginInput, RecoverVaultInput, SetUpVaultInput } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- AuthService is constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { AuthService, type SessionUser, type VaultEnvelope } from './auth.service.js'
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
  @UsePipes(new ZodValidationPipe(kdfQuerySchema))
  async kdf(@Query() query: KdfQuery) {
    return this.auth.kdfSaltFor(query.email)
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

  @Get('vault-envelope')
  @UseGuards(SessionGuard)
  vaultEnvelope(@CurrentUser() user: SessionUser): Promise<VaultEnvelope> {
    return this.auth.getVaultEnvelope(user.id)
  }

  @Post('vault-setup')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async setUpVault(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(setUpVaultSchema)) body: SetUpVaultInput,
  ): Promise<void> {
    await this.auth.setUpVault(user.id, body)
  }

  @Get('vault-recovery-envelope')
  recoveryEnvelope() {
    return this.auth.getRecoveryEnvelope()
  }

  @Post('vault-recover')
  @HttpCode(200)
  async recoverVault(
    @Body(new ZodValidationPipe(recoverVaultSchema)) body: RecoverVaultInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.setSessionCookie(response, await this.auth.recoverVault(body))
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
