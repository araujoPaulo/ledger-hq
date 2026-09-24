import { describe, expect, it } from 'vitest'
import {
  createAdHocChargeSchema,
  createRetainerPlanSchema,
  generateChargesBodySchema,
  generateChargesQuerySchema,
  proposeAllocationSchema,
  recordPaymentSchema,
  renewRetainerPlanSchema,
  writeOffChargeSchema,
} from './billing'

const clientId = '01927e6a-0000-7000-8000-000000000001'
const chargeId = '01927e6a-0000-7000-8000-000000000002'

describe('generateChargesQuerySchema', () => {
  it('accepts dryRun as "true" or "false"', () => {
    expect(generateChargesQuerySchema.safeParse({ dryRun: 'true' }).success).toBe(true)
    expect(generateChargesQuerySchema.safeParse({ dryRun: 'false' }).success).toBe(true)
  })

  it('accepts an omitted dryRun', () => {
    expect(generateChargesQuerySchema.safeParse({}).success).toBe(true)
  })

  it('rejects any other value', () => {
    expect(generateChargesQuerySchema.safeParse({ dryRun: 'yes' }).success).toBe(false)
  })
})

describe('generateChargesBodySchema', () => {
  it('accepts an empty body — sweeps every client as of now', () => {
    expect(generateChargesBodySchema.safeParse({}).success).toBe(true)
  })

  it('accepts an explicit asOf and clientId', () => {
    const result = generateChargesBodySchema.safeParse({ asOf: '2026-03-18', clientId })
    expect(result.success).toBe(true)
  })
})

describe('createRetainerPlanSchema', () => {
  it('accepts a valid plan', () => {
    const result = createRetainerPlanSchema.safeParse({
      amountCents: 9000,
      periodicity: 'MONTHLY',
      dueDayOfMonth: 8,
      validFrom: '2026-01-01',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a dueDayOfMonth above 28', () => {
    const result = createRetainerPlanSchema.safeParse({
      amountCents: 9000,
      periodicity: 'MONTHLY',
      dueDayOfMonth: 29,
      validFrom: '2026-01-01',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-positive amount', () => {
    const result = createRetainerPlanSchema.safeParse({
      amountCents: 0,
      periodicity: 'MONTHLY',
      dueDayOfMonth: 8,
      validFrom: '2026-01-01',
    })
    expect(result.success).toBe(false)
  })
})

describe('renewRetainerPlanSchema', () => {
  it('accepts just the required fields, periodicity/dueDayOfMonth optional', () => {
    const result = renewRetainerPlanSchema.safeParse({ newAmountCents: 12000, effectiveFrom: '2026-06-01' })
    expect(result.success).toBe(true)
  })
})

describe('proposeAllocationSchema', () => {
  it('accepts a valid proposal request', () => {
    const result = proposeAllocationSchema.safeParse({
      clientId,
      amountCents: 36000,
    })
    expect(result.success).toBe(true)
  })
})

describe('recordPaymentSchema', () => {
  it('accepts a valid payment with allocations', () => {
    const result = recordPaymentSchema.safeParse({
      clientId,
      amountCents: 36000,
      receivedOn: '2026-09-03',
      method: 'TRANSFER',
      allocations: [{ chargeId, amountCents: 9000 }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts an empty allocations array — a payment recorded as pure credit', () => {
    const result = recordPaymentSchema.safeParse({
      clientId,
      amountCents: 36000,
      receivedOn: '2026-09-03',
      method: 'TRANSFER',
      allocations: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid method', () => {
    const result = recordPaymentSchema.safeParse({
      clientId,
      amountCents: 36000,
      receivedOn: '2026-09-03',
      method: 'BITCOIN',
      allocations: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('createAdHocChargeSchema', () => {
  it('accepts a valid ad-hoc charge', () => {
    const result = createAdHocChargeSchema.safeParse({
      clientId,
      description: 'Consultoria extra',
      amountCents: 15000,
      dueOn: '2026-10-01',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an empty description', () => {
    const result = createAdHocChargeSchema.safeParse({
      clientId,
      description: '',
      amountCents: 15000,
      dueOn: '2026-10-01',
    })
    expect(result.success).toBe(false)
  })
})

describe('writeOffChargeSchema', () => {
  it('accepts a non-empty reason', () => {
    expect(writeOffChargeSchema.safeParse({ reason: 'Cliente insolvente' }).success).toBe(true)
  })

  it('rejects an empty or whitespace-only reason with the billing error code', () => {
    const result = writeOffChargeSchema.safeParse({ reason: '   ' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('billing.write_off_reason_required')
    }
  })
})
