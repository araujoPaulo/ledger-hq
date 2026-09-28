import type { ComponentPropsWithoutRef } from 'react'
import { cva } from 'class-variance-authority'

const card = cva('border border-line bg-surface rounded-surface', {
  variants: {
    padding: { none: '', sm: 'p-4', md: 'p-5' },
  },
  defaultVariants: { padding: 'md' },
})

type CardProps = ComponentPropsWithoutRef<'div'> & {
  padding?: 'none' | 'sm' | 'md'
}

export function Card({ padding, className, children, ...rest }: CardProps) {
  return (
    <div {...rest} className={`${card({ padding })}${className === undefined ? '' : ` ${className}`}`}>
      {children}
    </div>
  )
}
