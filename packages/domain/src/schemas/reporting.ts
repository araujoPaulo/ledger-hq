import { z } from 'zod'
import { isoDateSchema } from './common'

/** `asOf` omitted means today; the service, not the schema, supplies it. */
export const atRiskQuerySchema = z
  .object({ asOf: isoDateSchema.optional() })
  .strict()

export type AtRiskQuery = z.infer<typeof atRiskQuerySchema>

/**
 * No `message` override on the refine: the `ZodValidationPipe` promotes a
 * message that matches a known `ErrorCode` to that code, and the pipe
 * already wraps every failure as `common.validation_failed`. See the note in
 * `schemas/common.ts`.
 */
export const periodSummaryQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .strict()
  .refine((value) => value.from <= value.to, { path: ['to'] })

export type PeriodSummaryQuery = z.infer<typeof periodSummaryQuerySchema>
