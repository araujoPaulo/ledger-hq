import { Skeleton } from '../ui'

/** The ledger card's rows while they load; the card and its header are real. */
export function ClientLedgerSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex min-h-[44px] items-center justify-between gap-4 border-b border-line py-3 last:border-b-0">
          <Skeleton width="14rem" height="0.875rem" />
          <Skeleton width="5rem" height="0.875rem" />
        </div>
      ))}
    </div>
  )
}
