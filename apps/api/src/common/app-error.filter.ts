import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { Catch, HttpException } from '@nestjs/common'
import type { Response } from 'express'
import { AppError } from '@ledger-hq/domain'

/**
 * Catches every exception the Nest pipeline can throw, not only AppError.
 *
 * Nest's own default handling renders a prose `message` field (e.g. a raw
 * "Unexpected token in JSON" body-parser error, or "Forbidden" from a guard),
 * which violates the project-wide rule that the API never returns prose. Any
 * exception that is not an AppError is therefore reduced to the same
 * code-only envelope, reusing `common.validation_failed` — the closest
 * existing code for "the request could not be processed as sent" — rather
 * than inventing a new one. The exception's own status is preserved when it
 * is an HttpException (e.g. 403 from CsrfGuard, 400 from a malformed body);
 * anything else is treated as an unexpected fault and answered as 500. The
 * exception's message and stack are never read into the response.
 *
 * This does not cover requests to routes that do not exist at all: Express
 * serves those before Nest's exception zone ever sees them. See the fallback
 * middleware installed after `app.init()` in main.ts and test/app.ts.
 */
@Catch()
export class AppErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()

    if (exception instanceof AppError) {
      response.status(exception.status).json({
        error: { code: exception.code, params: exception.params },
      })
      return
    }

    const status = exception instanceof HttpException ? exception.getStatus() : 500

    response.status(status).json({
      error: { code: 'common.validation_failed', params: {} },
    })
  }
}
