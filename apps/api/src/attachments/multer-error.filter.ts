import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { BadRequestException, Catch, PayloadTooLargeException } from '@nestjs/common'
import type { Response } from 'express'
import { MulterError } from 'multer'
import { MAX_ATTACHMENT_BYTES } from '@ledger-hq/domain'

/**
 * Multer enforces the size cap while the body is still streaming and signals
 * it by throwing a `MulterError`, which is neither an `AppError` nor an
 * `HttpException`. The global `AppErrorFilter` would therefore render it as
 * `common.internal_error` at 500 — a file one byte over the limit reading as
 * a server fault.
 *
 * `FileInterceptor` never lets a raw `MulterError` reach a filter, though:
 * `@nestjs/platform-express`'s own `transformException` rewrites
 * `LIMIT_FILE_SIZE` into a `PayloadTooLargeException` and every other multer
 * code into a `BadRequestException` before the interceptor's promise
 * rejects (see `multer/multer.utils.js`). Without catching those too, this
 * filter would never fire in the running app — `MulterError` is kept here
 * only because the unit test below (and any other filter that calls
 * `.catch` directly with the raw error) still passes one — and the request
 * would fall through to the global `AppErrorFilter`, which renders the
 * 413 correctly but with `common.validation_failed` instead of the
 * `attachments.too_large` code the operator needs.
 *
 * Controller-scoped filters run before global ones, so this catches the
 * error first and keeps the code-only envelope (ADR 0004) intact.
 */
@Catch(MulterError, PayloadTooLargeException, BadRequestException)
export class MulterErrorFilter implements ExceptionFilter {
  catch(exception: MulterError | PayloadTooLargeException | BadRequestException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()

    const isFileTooLarge =
      exception instanceof PayloadTooLargeException || (exception instanceof MulterError && exception.code === 'LIMIT_FILE_SIZE')

    if (isFileTooLarge) {
      response.status(413).json({ error: { code: 'attachments.too_large', params: { maxBytes: MAX_ATTACHMENT_BYTES } } })
      return
    }

    response.status(422).json({ error: { code: 'common.validation_failed', params: {} } })
  }
}
