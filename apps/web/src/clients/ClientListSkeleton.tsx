import { Card, Skeleton } from '../ui'

/** The rows only: the filter bar above does not depend on data and stays real. */
export function ClientListSkeleton() {
  return (
    <Card padding="none" className="px-5" aria-busy="true">
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <div
          key={row}
          className="flex min-h-[44px] items-center justify-between gap-4 border-b border-line py-3 last:border-b-0"
        >
          <Skeleton width="12rem" height="0.875rem" />
          <Skeleton width="5rem" height="1.25rem" />
        </div>
      ))}
    </Card>
  )
}
