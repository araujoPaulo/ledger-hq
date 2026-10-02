import { Card, Skeleton } from '../ui'

export function SearchResultsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton width="6rem" height="1.25rem" />
      <Card padding="none" className="flex flex-col gap-3 px-5 py-4">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} height="0.875rem" />
        ))}
      </Card>
    </div>
  )
}
