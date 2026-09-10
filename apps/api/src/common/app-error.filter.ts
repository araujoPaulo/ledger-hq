import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common'
import type { Response } from 'express'
import { AppError } from '@ledger-hq/domain'

/**
 * Catches every exception the Nest pipeline can throw, not only AppError.
 *
 * Nest's own default handling renders a prose `message` field (e.g. a raw
 * "Unexpected token in JSON" body-parser error, or "Forbidden" from a guard),
 * which violates the project-wide rule that the API never returns prose. Any
 * exception that is not an AppError is therefore reduced to a code-only
 * envelope, reusing the existing `common.*` codes rather than inventing new
 * ones for the framework: a 403 (e.g. CsrfGuard) becomes `common.forbidden`,
 * anything else that carries its own HttpException status (e.g. 400 from a
 * malformed body) becomes `common.validation_failed`, and a genuine
 * unexpected fault (a non-HttpException, or anything at 500+) becomes
 * `common.internal_error` at status 500.
 *
 * Logging and rendering are kept separate: every non-AppError exception is
 * logged at error level with its message and stack, so an operator debugging
 * a real production failure isn't left with nothing but a status code —
 * installing this filter replaces Nest's own default handler, which is what
 * would otherwise have logged it. The response payload itself never reads
 * the exception's message or stack.
 *
 * This does not cover requests to routes that do not exist at all: Express
 * serves those before Nest's exception zone ever sees them. See the fallback
 * middleware installed after `app.init()` in main.ts and test/app.ts.
 */
@Catch()
export class AppErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppErrorFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()

    if (exception instanceof AppError) {
      response.status(exception.status).json({
        error: { code: exception.code, params: exception.params },
      })
      return
    }

    this.logger.error(
      exception instanceof Error ? exception.message : 'Non-Error exception thrown',
      exception instanceof Error ? exception.stack : undefined,
    )

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR

    const code =
      status === HttpStatus.FORBIDDEN
        ? 'common.forbidden'
        : status >= 500
          ? 'common.internal_error'
          : 'common.validation_failed'

    response.status(status).json({ error: { code, params: {} } })
  }
}
