import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cva } from 'class-variance-authority'

const callout = cva(
  'flex flex-col gap-4 rounded-surface border p-4 text-sm sm:flex-row sm:items-center sm:justify-between',
  {
    variants: {
      tone: {
        neutral: 'border-muted/20 bg-ground text-ink',
        warning: 'border-warning-700/20 bg-warning-50 text-warning-700',
        danger: 'border-danger-700/20 bg-danger-50 text-danger-700',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export type CalloutProps = {
  tone?: 'neutral' | 'warning' | 'danger' | undefined
  icon?: LucideIcon | undefined
  title?: string | undefined
  children: ReactNode
  action?: ReactNode
  /** Only for a message that must be announced when it appears, such as the vault gate's offline state. */
  role?: 'status' | 'alert' | undefined
}

/**
 * A persistent message about a section's state that is neither an error nor
 * empty — the generator preview, the vault not set up. Not a toast (it
 * stays) and not an `EmptyState` (there may be content below it).
 */
export function Callout({ tone = 'neutral', icon: Icon, title, children, action, role }: CalloutProps) {
  const iconClass = ['mt-0.5 h-4 w-4 shrink-0', tone === 'neutral' && 'text-muted'].filter(Boolean).join(' ')

  return (
    <div role={role} className={callout({ tone })}>
      <div className="flex min-w-0 items-start gap-2">
        {Icon !== undefined && <Icon aria-hidden="true" className={iconClass} />}
        <div className="flex min-w-0 flex-col gap-1">
          {title !== undefined && <p className="font-semibold">{title}</p>}
          <div className="font-normal">{children}</div>
        </div>
      </div>
      {action !== undefined && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}
