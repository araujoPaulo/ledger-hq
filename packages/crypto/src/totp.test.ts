import { describe, expect, it } from 'vitest'
import { generateTotp } from './totp'

// base32 encoding of the ASCII string "12345678901234567890", RFC 6238's own
// test secret.
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('generateTotp', () => {
  it('matches the RFC 6238 vector at T=59s (counter 1)', async () => {
    await expect(generateTotp(SECRET, new Date(59_000))).resolves.toBe('287082')
  })

  it('matches the RFC 6238 vector at T=1111111109s', async () => {
    await expect(generateTotp(SECRET, new Date(1_111_111_109_000))).resolves.toBe('081804')
  })

  it('matches the RFC 6238 vector at T=1111111111s', async () => {
    await expect(generateTotp(SECRET, new Date(1_111_111_111_000))).resolves.toBe('050471')
  })

  it('produces a 6-digit, zero-padded string', async () => {
    const code = await generateTotp(SECRET, new Date(0))
    expect(code).toMatch(/^\d{6}$/)
  })

  it('changes when the 30-second step changes', async () => {
    const a = await generateTotp(SECRET, new Date(0))
    const b = await generateTotp(SECRET, new Date(30_000))
    expect(a).not.toBe(b)
  })
})
