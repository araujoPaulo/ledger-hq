import type { Ref } from 'react'

type CardHeadingProps = { title: string; intro?: string; ref?: Ref<HTMLHeadingElement> }

/**
 * The card's own heading block: AuthLayout has no PageHeader, by design.
 * The heading is programmatically focusable so a mode switch can hand it focus.
 */
export function CardHeading({ title, intro, ref }: CardHeadingProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 ref={ref} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
        {title}
      </h1>
      {intro !== undefined && <p className="text-sm text-muted">{intro}</p>}
    </div>
  )
}
