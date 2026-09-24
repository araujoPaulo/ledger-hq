import type { ComponentPropsWithoutRef } from 'react'

type SkeletonProps = Omit<ComponentPropsWithoutRef<'span'>, 'style'> & {
  width?: string
  height?: string
}

export function Skeleton({ width = '100%', height = '1rem', className, ...rest }: SkeletonProps) {
  return (
    <span
      {...rest}
      aria-hidden="true"
      style={{ width, height }}
      className={`block animate-pulse rounded-control bg-line${className === undefined ? '' : ` ${className}`}`}
    />
  )
}
