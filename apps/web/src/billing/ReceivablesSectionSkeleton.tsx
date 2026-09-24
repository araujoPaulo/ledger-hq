import { Card, Skeleton } from '../ui'

export function ReceivablesSectionSkeleton() {
  return (
    <Card padding="none" className="px-5" aria-busy="true">
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex min-h-[44px] items-center justify-between gap-4 border-b border-line py-3 last:border-b-0"
        >
          <Skeleton height="0.875rem" />
          <Skeleton width="5rem" height="1.25rem" />
          <Skeleton width="5.5rem" height="0.875rem" />
        </div>
      ))}
    </Card>
  )
}
