/** Bytes explicitly backed by an ArrayBuffer, never a SharedArrayBuffer. */
export type Bytes = Uint8Array<ArrayBuffer>

export function toBase64(bytes: Bytes): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function fromBase64(value: string): Bytes {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function utf8(value: string): Bytes {
  return new TextEncoder().encode(value)
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32, no padding. Used for the recovery code and TOTP secrets. */
export function toBase32(bytes: Bytes): string {
  let bits = 0
  let value = 0
  let output = ''

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]

  return output
}

export function fromBase32(value: string): Bytes {
  const clean = value.toUpperCase().replace(/[^A-Z2-7]/g, '')
  const bytes: number[] = []
  let bits = 0
  let acc = 0

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char)
    acc = (acc << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((acc >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return new Uint8Array(bytes)
}
