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

/** Turns a stored period label such as `2026-Q1` into readable text. */
export function formatQuarter(periodLabel: string, locale: SupportedLocale): string {
  const [year, quarter] = periodLabel.split('-Q')
  if (year === undefined || quarter === undefined) return periodLabel

  return locale === 'pt-PT' ? `${quarter}.º trimestre de ${year}` : `Q${quarter} ${year}`
}
