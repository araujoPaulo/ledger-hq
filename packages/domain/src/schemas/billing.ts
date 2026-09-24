import { z } from 'zod'
import { PAYMENT_METHOD_VALUES, PERIODICITY_VALUES } from '../enums'
import { isoDateSchema, uuidSchema } from './common'

export const generateChargesQuerySchema = z
  .object({ dryRun: z.enum(['true', 'false']).optional() })
  .strict()

export type GenerateChargesQuery = z.infer<typeof generateChargesQuerySchema>

export const generateChargesBodySchema = z
  .object({
    asOf: isoDateSchema.optional(),
    clientId: uuidSchema.optional(),
  })
  .strict()

export type GenerateChargesInput = z.infer<typeof generateChargesBodySchema>

export const createRetainerPlanSchema = z
  .object({
    amountCents: z.number().int().positive(),
    periodicity: z.enum(PERIODICITY_VALUES),
    dueDayOfMonth: z.number().int().min(1).max(28),
    validFrom: isoDateSchema,
  })
  .strict()

export type CreateRetainerPlanInput = z.infer<typeof createRetainerPlanSchema>

export const renewRetainerPlanSchema = z
  .object({
    newAmountCents: z.number().int().positive(),
    effectiveFrom: isoDateSchema,
    periodicity: z.enum(PERIODICITY_VALUES).optional(),
    dueDayOfMonth: z.number().int().min(1).max(28).optional(),
  })
  .strict()

export type RenewRetainerPlanInput = z.infer<typeof renewRetainerPlanSchema>

export const proposeAllocationSchema = z
  .object({
    clientId: uuidSchema,
    amountCents: z.number().int().positive(),
  })
  .strict()

export type ProposeAllocationInput = z.infer<typeof proposeAllocationSchema>

export const recordPaymentSchema = z
  .object({
    clientId: uuidSchema,
    amountCents: z.number().int().positive(),
    receivedOn: isoDateSchema,
    method: z.enum(PAYMENT_METHOD_VALUES),
    reference: z.string().trim().max(200).optional(),
    allocations: z.array(
      z.object({
        chargeId: uuidSchema,
        amountCents: z.number().int().positive(),
      }),
    ),
  })
  .strict()

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>

export const createAdHocChargeSchema = z
  .object({
    clientId: uuidSchema,
    description: z.string().trim().min(1).max(200),
    amountCents: z.number().int().positive(),
    dueOn: isoDateSchema,
  })
  .strict()

export type CreateAdHocChargeInput = z.infer<typeof createAdHocChargeSchema>

export const writeOffChargeSchema = z
  .object({ reason: z.string() })
  .strict()
  .refine((value) => value.reason.trim().length > 0, {
    message: 'billing.write_off_reason_required',
    path: ['reason'],
  })

export type WriteOffChargeInput = z.infer<typeof writeOffChargeSchema>
