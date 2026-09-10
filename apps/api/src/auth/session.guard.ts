import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import type { Request } from 'express'
import { AppError } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { AuthService } from './auth.service.js'
import type { SessionUser } from './auth.service.js'

export const SESSION_COOKIE = 'lhq_session'

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: SessionUser }>()
    const token = request.cookies?.[SESSION_COOKIE]

    if (typeof token !== 'string' || token.length === 0) {
      throw new AppError('auth.session_expired', {}, 401)
    }

    request.user = await this.auth.resolveSession(token)
    return true
  }
}
