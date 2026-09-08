import { z } from 'zod'

/** A calendar date with no time and no zone, as stored in `date` columns. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'common.validation_failed')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: 'common.validation_failed',
  })

export const base64Schema = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/)

export const uuidSchema = z.uuid()
