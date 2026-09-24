import type { ChargeKind, ChargeStatus } from '../enums'

/** A row of the `charge_balances` database view (master spec §8.3). */
export type ChargeBalance = {
  id: string
  clientId: string
  kind: ChargeKind
  periodLabel: string | null
  /**
   * A `DATE` column read through `$queryRaw`, which Prisma hands back as a
   * `Date` — not a string. Typing it as a string made `proposeAllocation`'s
   * sort call `localeCompare` on a `Date`, which throws, but only once a
   * client had two open charges (`Array.sort` skips the comparator below
   * length 2). `getReceivables` always typed the same column correctly.
   */
  dueOn: Date
  amountCents: number
  allocatedCents: number
  outstandingCents: number
  status: ChargeStatus
}

export type ProposedAllocation = { chargeId: string; amountCents: number }
