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

// As a cell's first character, each of these makes Excel or LibreOffice
// read the cell as a formula rather than as text. `=`, `+` and `@` are the
// well-known triggers; a leading `-` also starts a (broken) formula, and a
// leading tab or carriage return has historically been used to smuggle a
// formula past a guard that only checks for `=`. The data reaching this
// export — client names, charge descriptions, write-off reasons — is free
// text the operator or client chose, not something this code controls.
const FORMULA_TRIGGER_CHARS = new Set(['=', '+', '-', '@', '\t', '\r'])

/**
 * The single leading apostrophe is not a stray character: it is the
 * spreadsheet convention for "this cell is text, not a formula". Without
 * it, a client named e.g. `=HYPERLINK(...)` would execute as a formula the
 * moment someone opens this file in Excel — the export's only destination.
 * Only the first character is checked, deliberately: a value that merely
 * *contains* `=` or `-` further in, like a date (`2026-01-08`) or a
 * description (`Total = 100`), must pass through untouched.
 */
function guardFormula(field: string): string {
  return FORMULA_TRIGGER_CHARS.has(field.charAt(0)) ? `'${field}` : field
}

function escapeField(field: string, delimiter: string): string {
  const guarded = guardFormula(field)
  if (!guarded.includes(delimiter) && !guarded.includes('"') && !guarded.includes('\n') && !guarded.includes('\r')) {
    return guarded
  }
  return `"${guarded.replaceAll('"', '""')}"`
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
