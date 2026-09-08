import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError } from '@ledger-hq/domain'
import { ZodValidationPipe } from './zod-validation.pipe.js'

const schema = z.object({ name: z.string().min(1), age: z.number() })

describe('ZodValidationPipe', () => {
  it('returns the parsed value when valid', () => {
    const pipe = new ZodValidationPipe(schema)

    expect(pipe.transform({ name: 'Ana', age: 40 })).toEqual({ name: 'Ana', age: 40 })
  })

  it('throws an AppError carrying one issue per failure', () => {
    const pipe = new ZodValidationPipe(schema)

    try {
      pipe.transform({ name: '', age: 'forty' })
      throw new Error('expected the pipe to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      const appError = error as AppError
      expect(appError.code).toBe('common.validation_failed')
      expect(appError.params.issues).toHaveLength(2)
      expect(appError.params.issues).toContainEqual({ path: 'name', code: 'too_small' })
    }
  })

  it('promotes a domain error code carried in the issue message', () => {
    const withDomainCode = z.object({
      endedOn: z.string(),
    }).superRefine((_value, context) => {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endedOn'],
        message: 'employment.ended_before_started',
      })
    })
    const pipe = new ZodValidationPipe(withDomainCode)

    try {
      pipe.transform({ endedOn: '2020-01-01' })
      throw new Error('expected the pipe to throw')
    } catch (error) {
      const appError = error as AppError
      expect(appError.params.issues).toContainEqual({
        path: 'endedOn',
        code: 'employment.ended_before_started',
      })
    }
  })
})
