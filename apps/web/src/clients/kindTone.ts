import type { ClientKind } from '@ledger-hq/domain'
import type { BadgeTone } from '../ui'

export const KIND_TONE: Record<ClientKind, BadgeTone> = {
  COMPANY: 'neutral',
  INDIVIDUAL: 'accent',
}
