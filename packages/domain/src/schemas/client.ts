import { z } from 'zod'
import { ACCOUNTING_VALUES, LEGAL_FORM_VALUES } from '../enums'
import { isValidNif } from '../identifiers/nif'
import { isValidNissFormat } from '../identifiers/niss'
import { isoDateSchema } from './common'

const sharedFields = {
  name: z.string().trim().min(1).max(200),
  taxId: z
    .string()
    .trim()
    .refine(isValidNif, { message: 'common.validation_failed' }),
  accounting: z.enum(ACCOUNTING_VALUES),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().max(5000).optional(),
}

const companySchema = z
  .object({
    kind: z.literal('COMPANY'),
    legalForm: z.enum(LEGAL_FORM_VALUES),
    ...sharedFields,
  })
  .strict()

const individualSchema = z
  .object({
    kind: z.literal('INDIVIDUAL'),
    socialSecurityNo: z
      .string()
      .trim()
      .refine(isValidNissFormat, { message: 'common.validation_failed' })
      .optional(),
    dateOfBirth: isoDateSchema.optional(),
    ...sharedFields,
  })
  .strict()

export const createClientSchema = z.discriminatedUnion('kind', [
  companySchema,
  individualSchema,
])

/** The client kind is immutable: changing it would invalidate history. */
export const updateClientSchema = z.discriminatedUnion('kind', [
  companySchema.partial().required({ kind: true }),
  individualSchema.partial().required({ kind: true }),
])

export type CreateClientInput = z.infer<typeof createClientSchema>
export type UpdateClientInput = z.infer<typeof updateClientSchema>
