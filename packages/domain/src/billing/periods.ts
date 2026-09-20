import type { Periodicity } from '../enums'

export type ChargePeriod = { start: Date; label: string }

function monthsPerStep(periodicity: Periodicity): number {
  if (periodicity === 'MONTHLY') return 1
  if (periodicity === 'QUARTERLY') return 3
  return 12
}

function alignedStartMonthIndex(periodicity: Periodicity, monthIndex: number): number {
  if (periodicity === 'QUARTERLY') return Math.floor(monthIndex / 3) * 3
  if (periodicity === 'ANNUAL') return 0
  return monthIndex
}

function labelFor(periodicity: Periodicity, cursor: Date): string {
  const year = cursor.getUTCFullYear()
  const month = cursor.getUTCMonth()
  if (periodicity === 'MONTHLY') return `${year}-${String(month + 1).padStart(2, '0')}`
  if (periodicity === 'QUARTERLY') return `${year}-Q${Math.floor(month / 3) + 1}`
  return `${year}`
}

/**
 * Every period whose start has already happened by `asOf`, starting from
 * the period containing `validFrom`. No future horizon — unlike the
 * obligation resolver's `generatePeriods`, this never looks ahead, matching
 * "a charge is born when its period begins" (master spec §8.1).
 */
export function chargePeriodsSince(periodicity: Periodicity, validFrom: Date, asOf: Date): ChargePeriod[] {
  const step = monthsPerStep(periodicity)
  const startMonthIndex = alignedStartMonthIndex(periodicity, validFrom.getUTCMonth())
  let cursor = new Date(Date.UTC(validFrom.getUTCFullYear(), startMonthIndex, 1))

  const periods: ChargePeriod[] = []
  while (cursor <= asOf) {
    periods.push({ start: cursor, label: labelFor(periodicity, cursor) })
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + step, 1))
  }
  return periods
}

/**
 * `dueDayOfMonth` within `periodStart`'s month, clamped to that month's
 * last day for short months (master spec §8.1). Uses the same "day 0 of
 * next month" idiom as the obligation resolver's `lastDayOfMonthsAfter`.
 */
export function chargeDueDate(periodStart: Date, dueDayOfMonth: number): Date {
  const lastDayOfMonth = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0)).getUTCDate()
  const day = Math.min(dueDayOfMonth, lastDayOfMonth)
  return new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), day))
}
