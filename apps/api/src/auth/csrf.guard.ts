import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { ForbiddenException, Injectable } from '@nestjs/common'
import type { Request } from 'express'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * SameSite=Strict already blocks cross-site cookie sending. This header check
 * is the second lock: a cross-origin form post cannot set a custom header.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()

    if (SAFE_METHODS.has(request.method)) return true
    if (request.header('x-requested-with') === 'ledger-hq') return true

    throw new ForbiddenException()
  }
}
