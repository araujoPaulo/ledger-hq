import { describe, expect, it } from 'vitest'
import { isValidNissFormat } from './niss'

describe('isValidNissFormat', () => {
  it('accepts an eleven-digit number beginning with 1 (natural person)', () => {
    expect(isValidNissFormat('11234567890')).toBe(true)
  })

  it('accepts an eleven-digit number beginning with 2 (legal person)', () => {
    expect(isValidNissFormat('21234567890')).toBe(true)
  })

  it.each([
    ['1123456789', 'ten digits'],
    ['112345678901', 'twelve digits'],
    ['31234567890', 'unassigned leading digit'],
    ['1123456789a', 'not all digits'],
    ['', 'empty'],
  ])('rejects %s (%s)', (value) => {
    expect(isValidNissFormat(value)).toBe(false)
  })

  it('ignores surrounding whitespace', () => {
    expect(isValidNissFormat(' 11234567890 ')).toBe(true)
  })
})
