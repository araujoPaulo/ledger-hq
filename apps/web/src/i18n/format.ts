export type SupportedLocale = 'pt-PT' | 'en-GB'

/** Deadlines are calendar dates, so they are parsed as UTC and never shifted. */
function toUtcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`)
}

export function formatDate(isoDate: string, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(toUtcDate(isoDate))
}

export function formatLongDate(isoDate: string, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(toUtcDate(isoDate))
}

export function formatCurrency(amountCents: number, locale: SupportedLocale): string {
  // useGrouping must be forced to `true`: this Node/ICU version's `auto`
  // default silently drops the thousands separator for pt-PT currency
  // amounts (but not for en-GB), which is a data quirk, not intended
  // locale behaviour.
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    useGrouping: true,
  }).format(amountCents / 100)
}

const SEPARATORS: Record<SupportedLocale, { decimal: string; group: string }> = {
  'pt-PT': { decimal: ',', group: '.' },
  'en-GB': { decimal: '.', group: ',' },
}

/**
 * An amount as typed, in integer cents — or `null` when the text is empty or
 * not an amount. The one place text becomes cents, beside the one place cents
 * become text (`formatCurrency`).
 *
 * The locale's decimal mark is the only decimal mark. The other separator is
 * accepted only as a thousands separator, between groups of exactly three
 * digits: in pt-PT "2.150" is 2150 euros, but "2150.50" is refused rather than
 * read as 215 050 euros. A run of whitespace between digits (Intl groups pt-PT with a
 * narrow no-break space) counts as the group mark and obeys the same rule; leading
 * and trailing whitespace and a euro sign at either end are ignored, so an amount copied from the
 * app's own display parses. No floating point: the digits are joined and
 * parsed as one integer.
 */
export function parseAmount(text: string, locale: SupportedLocale): number | null {
  const { decimal, group } = SEPARATORS[locale]
  // Whitespace between digits is a grouping mark (Intl emits U+00A0/U+202F), so
  // it goes through the same groups-of-three check as the locale's group char.
  // Any whitespace left after that (e.g. before the decimal mark) is refused.
  const compact = text
    .trim()
    .replace(/^€|€$/g, '')
    .trim()
    .replace(/(\d)\s+(?=\d)/g, `$1${group}`)
  if (compact === '') return null

  const parts = compact.split(decimal)
  if (parts.length > 2) return null
  const [whole = '', fraction = ''] = parts
  if (parts.length === 2 && !/^\d{1,2}$/.test(fraction)) return null

  const groups = whole.split(group)
  const isPlain = groups.length === 1 && /^\d+$/.test(whole)
  const isGrouped =
    groups.length > 1 && /^\d{1,3}$/.test(groups[0] ?? '') && groups.slice(1).every((part) => /^\d{3}$/.test(part))
  if (!isPlain && !isGrouped) return null

  const cents = Number.parseInt(`${groups.join('')}${fraction.padEnd(2, '0')}`, 10)
  return Number.isSafeInteger(cents) ? cents : null
}

/** An amount for an input field: grouped in the locale, two decimals, no symbol. */
export function formatAmount(amountCents: number, locale: SupportedLocale): string {
  // useGrouping forced for the same pt-PT ICU quirk formatCurrency documents.
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(amountCents / 100)
}

/** Turns a stored period label such as `2026-Q1` into readable text. */
export function formatQuarter(periodLabel: string, locale: SupportedLocale): string {
  const [year, quarter] = periodLabel.split('-Q')
  if (year === undefined || quarter === undefined) return periodLabel

  return locale === 'pt-PT' ? `${quarter}.º trimestre de ${year}` : `Q${quarter} ${year}`
}
