import type { ComponentPropsWithoutRef } from 'react'
import { cva } from 'class-variance-authority'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'severe' | 'danger'

const badge = cva('inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold', {
  variants: {
    tone: {
      neutral: 'bg-ground text-muted',
      accent: 'bg-accent-50 text-accent-700',
      success: 'bg-success-50 text-success-700',
      warning: 'bg-warning-50 text-warning-700',
      severe: 'bg-severe-50 text-severe-700',
      danger: 'bg-danger-50 text-danger-700',
    },
    shape: {
      tag: 'rounded-control',
      pill: 'rounded-full border border-current/20',
    },
    strikethrough: { true: 'line-through', false: '' },
  },
  defaultVariants: { tone: 'neutral', shape: 'tag', strikethrough: false },
})

type BadgeProps = ComponentPropsWithoutRef<'span'> & {
  tone?: BadgeTone
  shape?: 'tag' | 'pill'
  strikethrough?: boolean
}

export function Badge({ tone, shape, strikethrough, className, children, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={`${badge({ tone, shape, strikethrough })}${className === undefined ? '' : ` ${className}`}`}
    >
      {children}
    </span>
  )
}
