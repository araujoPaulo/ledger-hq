import { describe, expect, it } from 'vitest'
import { FISCAL_CATALOG } from './index'

describe('FISCAL_CATALOG', () => {
  it('aggregates all 18 entries with no duplicate codes', () => {
    expect(FISCAL_CATALOG).toHaveLength(18)
    expect(new Set(FISCAL_CATALOG.map((entry) => entry.code)).size).toBe(18)
  })

  it('every entry has validFrom, a legalRef, and both locales in i18n', () => {
    for (const entry of FISCAL_CATALOG) {
      expect(entry.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry.legalRef.length).toBeGreaterThan(0)
      expect(entry.i18n.pt.name.length).toBeGreaterThan(0)
      expect(entry.i18n.en.name.length).toBeGreaterThan(0)
    }
  })
})
