export type UrgencyGroup = 'overdue' | 'thisWeek' | 'thisMonth' | 'later'

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day))
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime())
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function endOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
}

/**
 * Buckets obligations by urgency relative to `today`: overdue (due date
 * before today), this week (today through 6 days out), this month (the rest
 * of the current calendar month), or later. Each bucket is sorted by due
 * date ascending. Shared by the global dashboard and the per-client
 * section — one grouping implementation, not a second one per screen.
 */
export function groupByUrgency<T extends { dueDate: string }>(
  items: T[],
  today: Date,
): Record<UrgencyGroup, T[]> {
  const todayUtc = startOfUtcDay(today)
  const weekEnd = addDays(todayUtc, 7)
  const monthEnd = endOfUtcMonth(todayUtc)

  const groups: Record<UrgencyGroup, T[]> = { overdue: [], thisWeek: [], thisMonth: [], later: [] }

  for (const item of items) {
    const due = parseIsoDate(item.dueDate)

    if (due < todayUtc) groups.overdue.push(item)
    else if (due < weekEnd) groups.thisWeek.push(item)
    else if (due <= monthEnd) groups.thisMonth.push(item)
    else groups.later.push(item)
  }

  for (const key of Object.keys(groups) as UrgencyGroup[]) {
    groups[key].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  }

  return groups
}
