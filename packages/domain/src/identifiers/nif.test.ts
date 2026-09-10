import { describe, expect, it } from 'vitest'
import { isValidNif } from './nif'

describe('isValidNif', () => {
  // Check digit: sum(digit[i] * (9 - i)) for i in 0..7, mod 11.
  // A remainder below 2 means a check digit of 0, otherwise 11 - remainder.
  it.each([
    ['123456789', 'individual, remainder 2, check digit 9'],
    ['501442600', 'company, remainder 1, check digit 0'],
    ['999999990', 'remainder 0, check digit 0'],
    ['451234561', 'non-resident individual (45x), remainder 10, check digit 1'],
  ])('accepts %s (%s)', (value) => {
    expect(isValidNif(value)).toBe(true)
  })

  it('rejects a wrong check digit', () => {
    expect(isValidNif('123456788')).toBe(false)
  })

  it.each([
    ['12345678', 'too short'],
    ['1234567890', 'too long'],
    ['12345678a', 'not all digits'],
    ['', 'empty'],
    ['023456789', 'first digit outside the assigned ranges'],
  ])('rejects %s (%s)', (value) => {
    expect(isValidNif(value)).toBe(false)
  })

  it('ignores surrounding whitespace', () => {
    expect(isValidNif('  123456789  ')).toBe(true)
  })
})
