import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { Catch } from '@nestjs/common'
import type { Response } from 'express'
import { AppError } from '@ledger-hq/domain'

@Catch(AppError)
export class AppErrorFilter implements ExceptionFilter {
  catch(exception: AppError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()

    response.status(exception.status).json({
      error: { code: exception.code, params: exception.params },
    })
  }
}
