import { fromBase32 } from './encoding'

const STEP_SECONDS = 30
const DIGITS = 6

/**
 * TOTP (RFC 6238) over HMAC-SHA1 (RFC 4226), 30-second steps, 6 digits — the
 * parameters every authenticator app and 2-step-verification portal assumes
 * by default. `secretBase32` is the shared secret exactly as a portal
 * displays it (e.g. "JBSWY3DP...").
 */
export async function generateTotp(secretBase32: string, at: Date = new Date()): Promise<string> {
  const counter = Math.floor(at.getTime() / 1000 / STEP_SECONDS)
  const counterBytes = new Uint8Array(8)
  new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter))

  const key = await crypto.subtle.importKey(
    'raw',
    fromBase32(secretBase32),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes))

  const offset = (signature[signature.length - 1] ?? 0) & 0x0f
  const binary =
    (((signature[offset] ?? 0) & 0x7f) << 24) |
    (((signature[offset + 1] ?? 0) & 0xff) << 16) |
    (((signature[offset + 2] ?? 0) & 0xff) << 8) |
    ((signature[offset + 3] ?? 0) & 0xff)

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}
