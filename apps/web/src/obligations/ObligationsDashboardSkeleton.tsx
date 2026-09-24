import { Card, Skeleton } from '../ui'

export function ObligationsDashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton width="6rem" height="1.25rem" />
      {[0, 1, 2].map((row) => (
        <Card key={row} padding="sm" className="flex items-center gap-4">
          <Skeleton height="0.875rem" />
          <Skeleton width="5rem" height="0.875rem" />
          <Skeleton width="6.5rem" height="1.75rem" />
        </Card>
      ))}
    </div>
  )
}
