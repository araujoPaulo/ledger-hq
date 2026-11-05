import { describe, expect, it } from 'vitest'
import { generateRecoveryCode } from '@ledger-hq/crypto'
import { caretInFormatted, formatRecoveryCode, significantBefore } from './recoveryCode'

const CANONICAL = 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z'

describe('formatRecoveryCode', () => {
  it('upper-cases and groups a code typed without hyphens', () => {
    expect(formatRecoveryCode('abcdefghijklmnopqrstuvwxyz')).toBe(CANONICAL)
  })

  it('drops spaces and any separator that is not a hyphen', () => {
    expect(formatRecoveryCode(' abcde  fghij–klmno_pqrst.uvwxy  z ')).toBe(CANONICAL)
  })

  it('formats a 38-character paste with extra spacing to the canonical code', () => {
    const pasted = ' abcde  fghij  klmno  pqrst  uvwxy  z '
    expect(pasted).toHaveLength(38)
    expect(formatRecoveryCode(pasted)).toBe(CANONICAL)
  })

  // Base32 (RFC 4648) has no 0, 1, 8 or 9, so they can only be typos.
  it('drops characters outside the base32 alphabet', () => {
    expect(formatRecoveryCode('AB0C1D8E9')).toBe('ABCDE')
  })

  it('leaves a canonical code unchanged', () => {
    expect(formatRecoveryCode(CANONICAL)).toBe(CANONICAL)
  })

  // The guarantee that matters: any code the generator can produce survives
  // formatting byte for byte, so recovery derives the same key from it.
  it('is a fixed point for codes from the real generator', () => {
    for (let run = 0; run < 50; run += 1) {
      const code = generateRecoveryCode()
      expect(formatRecoveryCode(code)).toBe(code)
    }
  })

  it('caps the code at 26 characters, however much is pasted', () => {
    expect(formatRecoveryCode('A'.repeat(40))).toBe('AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-A')
  })

  it('adds no trailing hyphen after a complete group', () => {
    expect(formatRecoveryCode('abcde')).toBe('ABCDE')
    expect(formatRecoveryCode('ABCDE-')).toBe('ABCDE')
  })

  it('returns an empty string for empty or separator-only input', () => {
    expect(formatRecoveryCode('')).toBe('')
    expect(formatRecoveryCode(' - - ')).toBe('')
  })
})

describe('significantBefore', () => {
  it('counts only code characters before the caret', () => {
    expect(significantBefore('ab-c d', 6)).toBe(4)
    expect(significantBefore('ab-c d', 3)).toBe(2)
    expect(significantBefore('abc', 0)).toBe(0)
  })
})

describe('caretInFormatted', () => {
  it('puts the caret after the n-th code character, skipping hyphens', () => {
    expect(caretInFormatted('ABCDE-F', 6)).toBe(7)
    expect(caretInFormatted('ABCKD-EFGHI-J', 4)).toBe(4)
  })

  it('stays before a hyphen that follows a complete group', () => {
    expect(caretInFormatted('ABCDE-F', 5)).toBe(5)
  })

  it('clamps to the ends', () => {
    expect(caretInFormatted('ABC', 0)).toBe(0)
    expect(caretInFormatted('ABC', 9)).toBe(3)
    expect(caretInFormatted('', 0)).toBe(0)
  })
})

describe('typing in the middle of a half-typed code', () => {
  // Mimics the field: insert at the caret, re-format, restore the caret.
  function type(value: string, caret: number, char: string) {
    const raw = value.slice(0, caret) + char + value.slice(caret)
    const formatted = formatRecoveryCode(raw)
    const next = caretInFormatted(formatted, significantBefore(raw, caret + char.length))
    return { value: formatted, caret: next }
  }

  it('inserts K then L after ABC and keeps the caret in place', () => {
    const first = type('ABCDE-FGHIJ', 3, 'K')
    expect(first).toEqual({ value: 'ABCKD-EFGHI-J', caret: 4 })

    const second = type(first.value, first.caret, 'L')
    expect(second).toEqual({ value: 'ABCKL-DEFGH-IJ', caret: 5 })
  })
})
