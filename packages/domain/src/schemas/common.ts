import { z } from 'zod'

/**
 * A calendar date with no time and no zone, as stored in `date` columns.
 *
 * No `message` override on the checks below: the `ZodValidationPipe`
 * promotes an issue's `message` to its per-issue `code` whenever the message
 * matches a known `ErrorCode`, so giving `common.validation_failed` (itself
 * a valid `ErrorCode`) as the message would collide with that mechanism and
 * report every failure as `common.validation_failed` instead of Zod's own
 * issue code.
 */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))

export const base64Schema = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/)

export const uuidSchema = z.uuid()
