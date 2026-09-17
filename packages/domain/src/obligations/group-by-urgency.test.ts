import { describe, expect, it } from 'vitest'
import { groupByUrgency } from './group-by-urgency'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

type Item = { id: string; dueDate: string }

describe('groupByUrgency', () => {
  const today = utc(2026, 3, 18) // a Wednesday

  it('buckets an overdue item', () => {
    const items: Item[] = [{ id: 'a', dueDate: '2026-03-01' }]
    expect(groupByUrgency(items, today).overdue).toEqual(items)
  })

  it('buckets an item due today as this week, not overdue', () => {
    const items: Item[] = [{ id: 'a', dueDate: '2026-03-18' }]
    expect(groupByUrgency(items, today).thisWeek).toEqual(items)
    expect(groupByUrgency(items, today).overdue).toEqual([])
  })

  it('buckets an item due within 7 days as this week', () => {
    const items: Item[] = [{ id: 'a', dueDate: '2026-03-20' }]
    expect(groupByUrgency(items, today).thisWeek).toEqual(items)
  })

  it('buckets an item due later in the same month as this month', () => {
    const items: Item[] = [{ id: 'a', dueDate: '2026-03-28' }]
    expect(groupByUrgency(items, today).thisMonth).toEqual(items)
  })

  it('buckets an item due next month as later', () => {
    const items: Item[] = [{ id: 'a', dueDate: '2026-04-05' }]
    expect(groupByUrgency(items, today).later).toEqual(items)
  })

  it('buckets an item due exactly 7 days out as this month, not this week', () => {
    const items: Item[] = [{ id: 'a', dueDate: '2026-03-25' }]
    expect(groupByUrgency(items, today).thisMonth).toEqual(items)
    expect(groupByUrgency(items, today).thisWeek).toEqual([])
  })

  it('buckets the last day of the month as this month, and the first day of the next as later', () => {
    const items: Item[] = [
      { id: 'lastDayOfMonth', dueDate: '2026-03-31' },
      { id: 'firstDayOfNextMonth', dueDate: '2026-04-01' },
    ]
    const result = groupByUrgency(items, today)
    expect(result.thisMonth).toEqual([items[0]])
    expect(result.later).toEqual([items[1]])
  })

  it('sorts each bucket by due date ascending', () => {
    const items: Item[] = [
      { id: 'later', dueDate: '2026-03-30' },
      { id: 'earlier', dueDate: '2026-03-27' },
    ]
    expect(groupByUrgency(items, today).thisMonth.map((item) => item.id)).toEqual(['earlier', 'later'])
  })

  it('returns all four keys even when every bucket is empty', () => {
    expect(groupByUrgency([], today)).toEqual({ overdue: [], thisWeek: [], thisMonth: [], later: [] })
  })
})
