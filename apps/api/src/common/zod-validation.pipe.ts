import type { PipeTransform } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import type { ZodSchema } from 'zod'
import { AppError, ERROR_CODES } from '@ledger-hq/domain'

type Issue = { path: string; code: string }

function isErrorCode(value: string): boolean {
  return (ERROR_CODES as readonly string[]).includes(value)
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value)
    if (result.success) return result.data

    const issues: Issue[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      // Cross-field rules carry a domain error code in the message; everything
      // else falls back to Zod's own machine-readable issue code.
      code: isErrorCode(issue.message) ? issue.message : issue.code,
    }))

    throw new AppError('common.validation_failed', { issues }, 422)
  }
}
