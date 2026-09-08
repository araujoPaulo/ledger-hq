import { z } from 'zod'
import { isoDateSchema, uuidSchema } from './common'

export const createEmploymentSchema = z
  .object({
    employerId: uuidSchema,
    employeeId: uuidSchema,
    startedOn: isoDateSchema,
    endedOn: isoDateSchema.optional(),
    jobTitle: z.string().trim().max(120).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.employerId === value.employeeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['employeeId'],
        message: 'employment.self_employment',
      })
    }

    if (value.endedOn !== undefined && value.endedOn < value.startedOn) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endedOn'],
        message: 'employment.ended_before_started',
      })
    }
  })

export const endEmploymentSchema = z.object({ endedOn: isoDateSchema }).strict()

export type CreateEmploymentInput = z.infer<typeof createEmploymentSchema>
export type EndEmploymentInput = z.infer<typeof endEmploymentSchema>
