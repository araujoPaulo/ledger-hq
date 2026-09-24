import type { UrgencyGroup } from '@ledger-hq/domain'
import type { BadgeTone } from '../ui'

export const URGENCY_TONE: Record<UrgencyGroup, BadgeTone> = {
  overdue: 'danger',
  thisWeek: 'warning',
  thisMonth: 'neutral',
  later: 'neutral',
}
