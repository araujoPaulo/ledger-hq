import { Card, Skeleton } from '../ui'

export function PlatformsPageSkeleton() {
  return (
    <Card padding="none" className="px-5" aria-busy="true">
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          className="flex min-h-[44px] items-center justify-between gap-4 border-b border-line py-3 last:border-b-0"
        >
          <span className="flex flex-1 items-center gap-4">
            <Skeleton width="2rem" height="2rem" />
            <span className="flex flex-1 flex-col gap-1.5">
              <Skeleton width="40%" height="0.875rem" />
              <Skeleton width="25%" height="0.75rem" />
            </span>
          </span>
          <Skeleton width="6rem" height="1.25rem" />
        </div>
      ))}
    </Card>
  )
}
