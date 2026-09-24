import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card } from './Card'

type EmptyStateProps = {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-700">
        <Icon aria-hidden="true" className="h-6 w-6" />
      </span>
      <p className="text-base font-semibold">{title}</p>
      {description !== undefined && <p className="max-w-sm text-sm font-normal text-muted">{description}</p>}
      {action}
    </Card>
  )
}
