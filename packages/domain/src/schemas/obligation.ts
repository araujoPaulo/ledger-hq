import { z } from 'zod'
import { OBLIGATION_STATUS_VALUES, PERIODICITY_VALUES } from '../enums'
import { isoDateSchema, uuidSchema } from './common'

export const listObligationsQuerySchema = z
  .object({
    clientId: uuidSchema.optional(),
    // Comma-separated ObligationStatus values (e.g. "PENDING,IN_PROGRESS");
    // parsed and validated member-by-member at the service layer rather
    // than here, since Zod has no built-in "comma-separated enum" primitive
    // and a bespoke regex would just re-derive OBLIGATION_STATUS_VALUES by hand.
    status: z.string().optional(),
  })
  .strict()

export type ListObligationsQuery = z.infer<typeof listObligationsQuerySchema>

export const generateObligationsQuerySchema = z
  .object({ dryRun: z.enum(['true', 'false']).optional() })
  .strict()

export type GenerateObligationsQuery = z.infer<typeof generateObligationsQuerySchema>

export const generateObligationsBodySchema = z
  .object({
    asOf: isoDateSchema.optional(),
    clientId: uuidSchema.optional(),
  })
  .strict()

export type GenerateObligationsInput = z.infer<typeof generateObligationsBodySchema>

export const patchObligationSchema = z
  .object({
    dueDate: isoDateSchema.optional(),
    status: z.enum(OBLIGATION_STATUS_VALUES).optional(),
    reference: z.string().trim().max(200).optional(),
    amountCents: z.number().int().nonnegative().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .refine((value) => value.status !== 'WAIVED' || (value.notes?.trim().length ?? 0) > 0, {
    message: 'obligations.waived_reason_required',
    path: ['notes'],
  })

export type PatchObligationInput = z.infer<typeof patchObligationSchema>

export const createAdHocObligationSchema = z
  .object({
    clientId: uuidSchema,
    code: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    periodicity: z.enum(PERIODICITY_VALUES),
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    periodLabel: z.string().trim().min(1).max(50),
    dueDate: isoDateSchema,
  })
  .strict()

export type CreateAdHocObligationInput = z.infer<typeof createAdHocObligationSchema>
