import type { BadgeTone } from '../ui'
import type { AgeingBucket } from './api'

// Four buckets need four steps; `severe` is the one the semantic trio
// (success/warning/danger) does not provide.
export const AGEING_TONE: Record<AgeingBucket, BadgeTone> = {
  '0-30': 'neutral',
  '31-60': 'warning',
  '61-90': 'severe',
  '90+': 'danger',
}
