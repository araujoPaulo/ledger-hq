// Generates placeholder PWA icons: solid background, "LHQ" lettering.
// Pure Node (zlib + Buffer), no image-library dependency, so these can be
// regenerated without installing anything. Replace with real artwork later
// without touching any code that references these paths.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(__dirname, '..', 'public')

// 5x7 bitmap font, just the glyphs we need: L, H, Q.
const FONT = {
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
}

function crc32(buf) {
  let c
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })())
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(width, height, pixels) {
  // pixels: Uint8Array RGBA, length = width * height * 4
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const idat = deflateSync(raw)

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function hexToRgb(hex) {
  const value = hex.replace('#', '')
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ]
}

function drawIcon({ size, background, foreground, safeZoneScale = 1 }) {
  const pixels = new Uint8Array(size * size * 4)
  const [br, bg, bb] = hexToRgb(background)
  const [fr, fg, fb] = hexToRgb(foreground)

  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = br
    pixels[i * 4 + 1] = bg
    pixels[i * 4 + 2] = bb
    pixels[i * 4 + 3] = 255
  }

  const text = 'LHQ'
  const glyphCols = 5
  const glyphRows = 7
  const gap = 1
  const textCols = text.length * glyphCols + (text.length - 1) * gap
  const textRows = glyphRows

  // Scale so the lettering fills roughly 60% of the icon (or the safe zone
  // for the maskable variant, which browsers may crop to a center circle).
  const targetWidth = size * 0.6 * safeZoneScale
  const scale = Math.max(1, Math.floor(targetWidth / textCols))
  const renderedWidth = textCols * scale
  const renderedHeight = textRows * scale
  const startX = Math.floor((size - renderedWidth) / 2)
  const startY = Math.floor((size - renderedHeight) / 2)

  let colOffset = 0
  for (const letter of text) {
    const glyph = FONT[letter]
    for (let row = 0; row < glyphRows; row++) {
      for (let col = 0; col < glyphCols; col++) {
        if (glyph[row][col] !== '1') continue
        const px0 = startX + (colOffset + col) * scale
        const py0 = startY + row * scale
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = px0 + dx
            const py = py0 + dy
            if (px < 0 || py < 0 || px >= size || py >= size) continue
            const idx = (py * size + px) * 4
            pixels[idx] = fr
            pixels[idx + 1] = fg
            pixels[idx + 2] = fb
            pixels[idx + 3] = 255
          }
        }
      }
    }
    colOffset += glyphCols + gap
  }

  return encodePng(size, size, pixels)
}

const THEME_BACKGROUND = '#0f172a' // matches manifest theme_color
const FOREGROUND = '#f8fafc' // matches manifest background_color

writeFileSync(path.join(outDir, 'icon-192.png'), drawIcon({ size: 192, background: THEME_BACKGROUND, foreground: FOREGROUND }))
writeFileSync(path.join(outDir, 'icon-512.png'), drawIcon({ size: 512, background: THEME_BACKGROUND, foreground: FOREGROUND }))
// Maskable icons get cropped to a center safe zone by the OS, so shrink the
// lettering relative to the canvas to keep it inside that zone.
writeFileSync(
  path.join(outDir, 'icon-maskable.png'),
  drawIcon({ size: 512, background: THEME_BACKGROUND, foreground: FOREGROUND, safeZoneScale: 0.7 }),
)

console.log('Generated icon-192.png, icon-512.png, icon-maskable.png in', outDir)
