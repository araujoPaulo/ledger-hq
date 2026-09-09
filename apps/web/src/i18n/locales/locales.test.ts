import { describe, expect, it } from 'vitest'
import {
  ACCOUNTING_VALUES,
  CLIENT_KIND_VALUES,
  ERROR_CODES,
  INCOME_TAX_VALUES,
  LEGAL_FORM_VALUES,
  VAT_REGIME_VALUES,
} from '@ledger-hq/domain'
import * as pt from './pt'
import * as en from './en'

function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]

  return Object.entries(value).flatMap(([key, nested]) =>
    flatten(nested, prefix === '' ? key : `${prefix}.${key}`),
  )
}

describe('locale bundles', () => {
  it('define exactly the same keys', () => {
    const ptKeys = flatten(pt.resources).sort()
    const enKeys = flatten(en.resources).sort()

    expect(enKeys).toEqual(ptKeys)
  })
})

describe('domain enumerations', () => {
  it.each([
    ['clientKind', CLIENT_KIND_VALUES],
    ['legalForm', LEGAL_FORM_VALUES],
    ['accounting', ACCOUNTING_VALUES],
    ['vatRegime', VAT_REGIME_VALUES],
    ['incomeTax', INCOME_TAX_VALUES],
  ])('translate every %s value in both locales', (group, values) => {
    for (const value of values) {
      expect(pt.resources.domain[group as keyof typeof pt.resources.domain]).toHaveProperty(value)
      expect(en.resources.domain[group as keyof typeof en.resources.domain]).toHaveProperty(value)
    }
  })
})

describe('error codes', () => {
  it('every registered code has a message in both locales', () => {
    const ptKeys = new Set(flatten(pt.resources.errors))
    const enKeys = new Set(flatten(en.resources.errors))

    for (const code of ERROR_CODES) {
      expect(ptKeys.has(code)).toBe(true)
      expect(enKeys.has(code)).toBe(true)
    }
  })
})
