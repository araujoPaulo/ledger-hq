import { describe, expect, it } from 'vitest'
import {
  AUTHORITY_VALUES,
  DEFINITION_SOURCE_VALUES,
  OBLIGATION_STATUS_VALUES,
  PERIODICITY_VALUES,
} from './enums'

describe('obligation enums', () => {
  it('AUTHORITY_VALUES has the four authorities the master spec names', () => {
    expect(AUTHORITY_VALUES).toEqual(['TAX', 'SOCIAL_SECURITY', 'REGISTRY', 'OTHER'])
  })

  it('PERIODICITY_VALUES has the four periodicities', () => {
    expect(PERIODICITY_VALUES).toEqual(['MONTHLY', 'QUARTERLY', 'ANNUAL', 'ONE_OFF'])
  })

  it('OBLIGATION_STATUS_VALUES has the four statuses', () => {
    expect(OBLIGATION_STATUS_VALUES).toEqual(['PENDING', 'IN_PROGRESS', 'DONE', 'WAIVED'])
  })

  it('DEFINITION_SOURCE_VALUES distinguishes catalog from user-created', () => {
    expect(DEFINITION_SOURCE_VALUES).toEqual(['CATALOG', 'CUSTOM'])
  })
})
