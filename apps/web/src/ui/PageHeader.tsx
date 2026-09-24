import type { ReactNode } from 'react'

type PageHeaderProps = {
  title: string
  description?: string
  actions?: ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && <p className="text-sm text-muted">{description}</p>}
      </div>
      {actions !== undefined && <div className="flex items-center gap-4">{actions}</div>}
    </header>
  )
}
