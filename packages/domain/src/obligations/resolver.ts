import { nextBusinessDay } from './holidays'
import type { CatalogEntry, ObligationSubject, Period } from './catalog-types'

/**
 * `subject` is a plain object keyed by every field a condition can name;
 * reading it dynamically by `condition.field` is safe (every `Condition`
 * variant's `field` is one of `ObligationSubject`'s own keys) but not
 * something the type checker can verify across a discriminated union, hence
 * the one narrow cast.
 */
export function appliesTo(definition: CatalogEntry, subject: ObligationSubject): boolean {
  return definition.appliesWhen.all.every((condition) => {
    const actual = (subject as unknown as Record<string, unknown>)[condition.field]
    return actual === condition.value
  })
}

export function generatePeriods(
  periodicity: CatalogEntry['periodicity'],
  from: Date,
  to: Date,
): Period[] {
  switch (periodicity) {
    case 'MONTHLY':
      return monthlyPeriods(from, to)
    case 'QUARTERLY':
      return quarterlyPeriods(from, to)
    case 'ANNUAL':
      return annualPeriods(from, to)
    case 'ONE_OFF':
      return []
  }
}

function monthlyPeriods(from: Date, to: Date): Period[] {
  const periods: Period[] = []
  let year = from.getUTCFullYear()
  let month = from.getUTCMonth()

  for (;;) {
    const start = new Date(Date.UTC(year, month, 1))
    if (start > to) break

    const end = new Date(Date.UTC(year, month + 1, 0))
    if (end >= from) {
      periods.push({ start, end, label: `${year}-${String(month + 1).padStart(2, '0')}` })
    }

    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
  }

  return periods
}

function quarterlyPeriods(from: Date, to: Date): Period[] {
  const periods: Period[] = []
  let year = from.getUTCFullYear()
  let quarter = Math.floor(from.getUTCMonth() / 3)

  for (;;) {
    const startMonth = quarter * 3
    const start = new Date(Date.UTC(year, startMonth, 1))
    if (start > to) break

    const end = new Date(Date.UTC(year, startMonth + 3, 0))
    if (end >= from) {
      periods.push({ start, end, label: `${year}-Q${quarter + 1}` })
    }

    quarter += 1
    if (quarter > 3) {
      quarter = 0
      year += 1
    }
  }

  return periods
}

function annualPeriods(from: Date, to: Date): Period[] {
  const periods: Period[] = []
  let year = from.getUTCFullYear()

  for (;;) {
    const start = new Date(Date.UTC(year, 0, 1))
    if (start > to) break

    const end = new Date(Date.UTC(year, 11, 31))
    if (end >= from) {
      periods.push({ start, end, label: `${year}` })
    }

    year += 1
  }

  return periods
}

export function resolveDueDate(
  definition: Pick<CatalogEntry, 'deadline' | 'businessDayShift'>,
  period: Period,
): Date {
  const { deadline } = definition

  const raw =
    deadline.kind === 'dayOfMonthAfterPeriodEnd'
      ? addMonthsAndSetDay(period.end, deadline.monthsAfter, deadline.day)
      : deadline.kind === 'lastDayOfMonthAfterPeriodEnd'
        ? lastDayOfMonthsAfter(period.end, deadline.monthsAfter)
        : new Date(Date.UTC(period.end.getUTCFullYear() + deadline.yearsAfter, deadline.month - 1, deadline.day))

  return definition.businessDayShift === 'NEXT' ? nextBusinessDay(raw) : raw
}

function addMonthsAndSetDay(periodEnd: Date, monthsAfter: number, day: number): Date {
  const totalMonths = periodEnd.getUTCMonth() + monthsAfter
  const year = periodEnd.getUTCFullYear() + Math.floor(totalMonths / 12)
  const month = totalMonths % 12
  return new Date(Date.UTC(year, month, day))
}

/** Day 0 of the month after the target month is JavaScript's own idiom for "the last day of the target month" — it never overflows into the month beyond, unlike setting a fixed day-of-month such as 31. */
function lastDayOfMonthsAfter(periodEnd: Date, monthsAfter: number): Date {
  const totalMonths = periodEnd.getUTCMonth() + monthsAfter
  const year = periodEnd.getUTCFullYear() + Math.floor(totalMonths / 12)
  const month = totalMonths % 12
  return new Date(Date.UTC(year, month + 1, 0))
}
