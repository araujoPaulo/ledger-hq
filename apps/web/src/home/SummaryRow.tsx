import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { groupByUrgency } from '@ledger-hq/domain'
import type { UrgencyGroup } from '@ledger-hq/domain'
import { Card, Money, Skeleton } from '../ui'
import { listObligations } from '../obligations/api'
import { getReceivables } from '../billing/api'

// Not URGENCY_TONE: that map returns badge tones (a tint plus a -700 text
// shade), and a tile's large number is coloured text on a plain card.
const COUNT_TONE_CLASS: Record<UrgencyGroup, string> = {
  overdue: 'text-danger-700',
  thisWeek: 'text-warning-700',
  thisMonth: 'text-ink',
  later: 'text-ink',
}

// `later` is deliberately absent: a deadline three months out is not news,
// and a tile that is always populated reads as noise.
const TILES: UrgencyGroup[] = ['overdue', 'thisWeek', 'thisMonth']

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-muted">{label}</span>
      {children}
    </Card>
  )
}

export function SummaryRow() {
  const { t } = useTranslation(['common', 'obligations'])

  // The same query keys the two sections below use, so React Query serves all
  // four call sites from two requests.
  const obligations = useQuery({ queryKey: ['obligations'], queryFn: () => listObligations() })
  const receivables = useQuery({ queryKey: ['receivables'], queryFn: getReceivables })

  const groups = obligations.data === undefined ? undefined : groupByUrgency(obligations.data, new Date())
  const populated = groups === undefined ? [] : TILES.filter((key) => groups[key].length > 0)

  // Nothing loaded and nothing loading: say nothing rather than show zeros.
  // "0 overdue" when the request simply failed is a wrong answer stated
  // confidently.
  if (obligations.isError && receivables.isError) return null
  if (!obligations.isPending && populated.length === 0 && receivables.isError) return null

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {obligations.isPending
        ? TILES.map((key) => (
            <Tile key={key} label={t(`obligations:dashboard.${key}`)}>
              <Skeleton width="2.75rem" height="1.75rem" />
            </Tile>
          ))
        : populated.map((key) => (
            <Tile key={key} label={t(`obligations:dashboard.${key}`)}>
              <span className={`text-2xl font-semibold tabular-nums ${COUNT_TONE_CLASS[key]}`}>
                {groups === undefined ? 0 : groups[key].length}
              </span>
            </Tile>
          ))}

      {receivables.isError ? null : (
        <Tile label={t('common:home.outstanding')}>
          {receivables.isPending ? (
            <Skeleton width="8rem" height="1.75rem" />
          ) : (
            <Money cents={receivables.data.reduce((sum, row) => sum + row.outstandingCents, 0)} size="lg" />
          )}
        </Tile>
      )}
    </div>
  )
}
