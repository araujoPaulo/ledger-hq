import type { ChargeKind, ChargeStatus } from '../enums'

/** A row of the `charge_balances` database view (master spec §8.3). */
export type ChargeBalance = {
  id: string
  clientId: string
  kind: ChargeKind
  periodLabel: string | null
  dueOn: string
  amountCents: number
  allocatedCents: number
  outstandingCents: number
  status: ChargeStatus
}

export type ProposedAllocation = { chargeId: string; amountCents: number }
