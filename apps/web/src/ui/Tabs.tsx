import type { ComponentPropsWithoutRef } from 'react'
import * as RadixTabs from '@radix-ui/react-tabs'

/** Scrolls sideways rather than wrapping, with the scrollbar hidden — a phone's tab strip. */
function List({ className, ...rest }: ComponentPropsWithoutRef<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      {...rest}
      className={[
        'flex gap-1 overflow-x-auto border-b border-line',
        '[scrollbar-width:none]',
        '[&::-webkit-scrollbar]:hidden',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  )
}

/**
 * The active tab's 2px rule overlaps the strip's 1px border (`-mb-px`), so the
 * two read as one line. A `Badge` or icon after the label is part of the
 * tab's accessible name.
 */
function Trigger({ className, ...rest }: ComponentPropsWithoutRef<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      {...rest}
      className={[
        '-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3.5 py-2.5',
        'text-sm font-medium text-muted outline-none transition-colors hover:text-ink',
        'focus-visible:ring-2 focus-visible:ring-accent-600',
        'data-[state=active]:border-accent-600 data-[state=active]:font-semibold',
        'data-[state=active]:text-accent-700',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  )
}

/** `Content` is Radix's, unstyled: without `forceMount`, an inactive panel is unmounted. */
export const Tabs = Object.assign(RadixTabs.Root, { List, Trigger, Content: RadixTabs.Content })
