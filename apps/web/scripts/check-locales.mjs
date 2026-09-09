import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const localesDir = new URL('../src/i18n/locales', import.meta.url).pathname
const locales = ['pt', 'en']

function flatten(value, prefix = '') {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, nested]) =>
    flatten(nested, prefix === '' ? key : `${prefix}.${key}`),
  )
}

function keysFor(locale) {
  const dir = join(localesDir, locale)
  const keys = new Set()

  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const namespace = file.replace(/\.json$/, '')
    const contents = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    for (const key of flatten(contents)) keys.add(`${namespace}:${key}`)
  }

  return keys
}

const [pt, en] = locales.map(keysFor)
const missingInEn = [...pt].filter((key) => !en.has(key))
const missingInPt = [...en].filter((key) => !pt.has(key))

if (missingInEn.length > 0 || missingInPt.length > 0) {
  console.error('Locale bundles diverge.')
  for (const key of missingInEn) console.error(`  missing in en: ${key}`)
  for (const key of missingInPt) console.error(`  missing in pt: ${key}`)
  process.exit(1)
}

console.log(`Locale bundles agree on ${pt.size} keys.`)
