import { describe, expect, it } from 'vitest'
import { createEmploymentSchema, endEmploymentSchema } from './employment'

const employerId = '0192f1a0-0000-7000-8000-000000000001'
const employeeId = '0192f1a0-0000-7000-8000-000000000002'

const spell = { employerId, employeeId, startedOn: '2024-01-15' }

describe('createEmploymentSchema', () => {
  it('accepts an open-ended spell', () => {
    expect(createEmploymentSchema.safeParse(spell).success).toBe(true)
  })

  it('accepts a closed spell with a job title', () => {
    const result = createEmploymentSchema.safeParse({
      ...spell,
      endedOn: '2025-06-30',
      jobTitle: 'Bookkeeper',
    })

    expect(result.success).toBe(true)
  })

  it('rejects an end date before the start date', () => {
    const result = createEmploymentSchema.safeParse({ ...spell, endedOn: '2023-12-31' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('employment.ended_before_started')
  })

  it('accepts an end date equal to the start date', () => {
    expect(createEmploymentSchema.safeParse({ ...spell, endedOn: '2024-01-15' }).success).toBe(true)
  })

  it('rejects somebody employing themselves', () => {
    const result = createEmploymentSchema.safeParse({ ...spell, employeeId: employerId })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('employment.self_employment')
  })

  it('rejects a non-uuid identifier', () => {
    expect(createEmploymentSchema.safeParse({ ...spell, employerId: 'abc' }).success).toBe(false)
  })
})

describe('endEmploymentSchema', () => {
  it('accepts a termination date', () => {
    expect(endEmploymentSchema.safeParse({ endedOn: '2026-03-31' }).success).toBe(true)
  })

  it('rejects a missing date', () => {
    expect(endEmploymentSchema.safeParse({}).success).toBe(false)
  })
})
