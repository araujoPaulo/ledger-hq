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
