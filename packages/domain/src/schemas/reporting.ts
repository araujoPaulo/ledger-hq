import { z } from 'zod'
import { isoDateSchema } from './common'

/** `asOf` omitted means today; the service, not the schema, supplies it. */
export const atRiskQuerySchema = z
  .object({ asOf: isoDateSchema.optional() })
  .strict()

export type AtRiskQuery = z.infer<typeof atRiskQuerySchema>
