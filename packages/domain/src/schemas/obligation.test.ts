import { describe, expect, it } from 'vitest'
import {
  createAdHocObligationSchema,
  generateObligationsBodySchema,
  listObligationsQuerySchema,
  patchObligationSchema,
} from './obligation'

const uuid = '01927e6a-0000-7000-8000-000000000000'

describe('listObligationsQuerySchema', () => {
  it('accepts no filters', () => {
    expect(listObligationsQuerySchema.safeParse({}).success).toBe(true)
  })

  it('accepts a clientId and a comma-separated status filter', () => {
    const result = listObligationsQuerySchema.safeParse({ clientId: uuid, status: 'PENDING,IN_PROGRESS' })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown field', () => {
    expect(listObligationsQuerySchema.safeParse({ clientId: uuid, bogus: '1' }).success).toBe(false)
  })
})

describe('generateObligationsBodySchema', () => {
  it('accepts an empty body — asOf and clientId both default at the service layer', () => {
    expect(generateObligationsBodySchema.safeParse({}).success).toBe(true)
  })

  it('accepts an explicit asOf and clientId', () => {
    expect(generateObligationsBodySchema.safeParse({ asOf: '2026-03-18', clientId: uuid }).success).toBe(true)
  })

  it('rejects a non-ISO asOf', () => {
    expect(generateObligationsBodySchema.safeParse({ asOf: '18/03/2026' }).success).toBe(false)
  })
})

describe('patchObligationSchema', () => {
  it('accepts a due-date override alone', () => {
    expect(patchObligationSchema.safeParse({ dueDate: '2026-04-01' }).success).toBe(true)
  })

  it('accepts marking DONE with no notes', () => {
    expect(patchObligationSchema.safeParse({ status: 'DONE' }).success).toBe(true)
  })

  it('rejects marking WAIVED with no notes', () => {
    const result = patchObligationSchema.safeParse({ status: 'WAIVED' })
    expect(result.success).toBe(false)
  })

  it('rejects marking WAIVED with blank notes', () => {
    expect(patchObligationSchema.safeParse({ status: 'WAIVED', notes: '   ' }).success).toBe(false)
  })

  it('accepts marking WAIVED with a real reason', () => {
    expect(patchObligationSchema.safeParse({ status: 'WAIVED', notes: 'Client ceased activity' }).success).toBe(true)
  })
})

describe('createAdHocObligationSchema', () => {
  it('accepts a well-formed ad-hoc obligation', () => {
    const result = createAdHocObligationSchema.safeParse({
      clientId: uuid,
      code: 'BACKUP_RESTORE_DRILL',
      name: 'Backup restore drill',
      periodicity: 'ONE_OFF',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-01',
      periodLabel: '2026',
      dueDate: '2026-03-31',
    })
    expect(result.success).toBe(true)
  })
})
