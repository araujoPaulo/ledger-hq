import { describe, expect, it } from 'vitest'
import { fromBase32, toBase32 } from './encoding'

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(20))
    expect(fromBase32(toBase32(bytes))).toEqual(bytes)
  })

  it('matches the RFC 4648 test vector for "12345678901234567890"', () => {
    const bytes = new TextEncoder().encode('12345678901234567890')
    expect(toBase32(bytes)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  })

  it('decodes lowercase and dash-separated input', () => {
    const bytes = new TextEncoder().encode('12345678901234567890')
    expect(fromBase32('gezdgnbv-gy3tqojq-gezdgnbv-gy3tqojq')).toEqual(bytes)
  })
})
