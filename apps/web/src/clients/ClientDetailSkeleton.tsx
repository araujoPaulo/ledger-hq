import { Card, Skeleton } from '../ui'

/** Header block, tab strip, and the Overview's two columns. */
export function ClientDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-4">
        <Skeleton width="5rem" height="0.75rem" />
        <Skeleton width="16rem" height="2rem" />
        <Skeleton width="20rem" height="1rem" />
      </div>
      <div className="flex gap-4 border-b border-line pb-3">
        {[0, 1, 2, 3, 4].map((tab) => (
          <Skeleton key={tab} width="5.5rem" height="1rem" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <Skeleton height="10rem" />
        </Card>
        <Card>
          <Skeleton height="6rem" />
        </Card>
      </div>
    </div>
  )
}
