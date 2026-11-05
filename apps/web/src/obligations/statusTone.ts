import type { ObligationStatus } from '@ledger-hq/domain'
import type { BadgeTone } from '../ui'

/** Pending is the normal state and carries no badge; the row shows the others. */
export const STATUS_TONE: Record<ObligationStatus, BadgeTone> = {
  PENDING: 'neutral',
  IN_PROGRESS: 'accent',
  DONE: 'success',
  WAIVED: 'neutral',
}
