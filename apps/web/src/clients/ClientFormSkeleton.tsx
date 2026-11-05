import { Card, Skeleton } from '../ui'

/** The edit page while its client loads: back link, title, two sections of fields. */
export function ClientFormSkeleton() {
  return (
    <div className="flex max-w-3xl flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-4">
        <Skeleton width="8rem" height="0.875rem" />
        <Skeleton width="14rem" height="2rem" />
      </div>
      {[0, 1].map((section) => (
        <Card key={section} className="flex flex-col gap-4">
          <Skeleton width="7rem" height="0.75rem" />
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((field) => (
              <div key={field} className="flex flex-col gap-1.5">
                <Skeleton width="6rem" height="0.875rem" />
                <Skeleton height="2.5rem" />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
