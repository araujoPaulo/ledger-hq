import type { SupportedLocale } from '../i18n/format'

// Excel takes the delimiter from its own locale: a comma-separated file
// opens as one column per row on a Portuguese machine.
const DELIMITER: Record<SupportedLocale, string> = { 'pt-PT': ';', 'en-GB': ',' }

// Built from its code point rather than written as the literal character:
// the literal is invisible in source and trips this repo's
// `no-irregular-whitespace` lint rule.
const BOM = String.fromCharCode(0xfeff)

/**
 * An amount for a spreadsheet cell — NOT `formatCurrency`.
 *
 * `formatCurrency` emits `9 000,00 €`, and both halves of that are wrong
 * here: the euro sign makes Excel treat the cell as text rather than a
 * number, and the grouping separator is the delimiter under `en-GB`. A plain
 * two-decimal number with the locale's decimal mark is what Excel parses.
 */
export function formatCsvAmount(cents: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(cents / 100)
}

function escapeField(field: string, delimiter: string): string {
  if (!field.includes(delimiter) && !field.includes('"') && !field.includes('\n') && !field.includes('\r')) {
    return field
  }
  return `"${field.replaceAll('"', '""')}"`
}

/**
 * Builds the file in the browser rather than on the server, because ADR 0004
 * requires it: a header row is prose, and a server-rendered CSV would have to
 * know the caller's locale to write `Cliente` or `Client`. It also means the
 * file's numbers and dates come from the same formatters the screen used, so
 * file and screen cannot disagree.
 *
 * CRLF line endings: that is what RFC 4180 specifies and what Excel expects.
 */
export function toCsv(headers: string[], rows: string[][], locale: SupportedLocale): string {
  const delimiter = DELIMITER[locale]
  const lines = [headers, ...rows].map((row) => row.map((field) => escapeField(field, delimiter)).join(delimiter))

  // The BOM is not decoration: without it Excel decodes the file as the
  // system's legacy codepage and renders `Araújo` as mojibake.
  return `${BOM}${lines.join('\r\n')}\r\n`
}

export function downloadCsv(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // Revoking immediately is safe: the browser has already taken its own
  // reference by the time click() returns, and not revoking leaks the blob
  // for the life of the document.
  URL.revokeObjectURL(url)
}
