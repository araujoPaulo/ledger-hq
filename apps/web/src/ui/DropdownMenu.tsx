import type { ComponentPropsWithoutRef } from 'react'
import * as RadixDropdownMenu from '@radix-ui/react-dropdown-menu'

const ITEM_CLASS =
  'flex h-[34px] cursor-pointer select-none items-center gap-2 rounded-control px-3 text-sm outline-none data-[highlighted]:bg-ground'

function Content({ className, children, ...rest }: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Content>) {
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.Content
        align="end"
        sideOffset={6}
        {...rest}
        className={`min-w-[12rem] rounded-surface border border-line bg-surface p-1.5 shadow-overlay${className === undefined ? '' : ` ${className}`}`}
      >
        {children}
      </RadixDropdownMenu.Content>
    </RadixDropdownMenu.Portal>
  )
}

function Item({ className, ...rest }: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Item>) {
  return (
    <RadixDropdownMenu.Item {...rest} className={`${ITEM_CLASS}${className === undefined ? '' : ` ${className}`}`} />
  )
}

function RadioItem({ className, ...rest }: ComponentPropsWithoutRef<typeof RadixDropdownMenu.RadioItem>) {
  return (
    <RadixDropdownMenu.RadioItem
      {...rest}
      className={`${ITEM_CLASS} data-[state=checked]:font-semibold${className === undefined ? '' : ` ${className}`}`}
    />
  )
}

function Label({ className, ...rest }: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Label>) {
  return (
    <RadixDropdownMenu.Label
      {...rest}
      className={`px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted${className === undefined ? '' : ` ${className}`}`}
    />
  )
}

function Separator({ className, ...rest }: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Separator>) {
  return (
    <RadixDropdownMenu.Separator
      {...rest}
      className={`my-1.5 h-px bg-line${className === undefined ? '' : ` ${className}`}`}
    />
  )
}

export const DropdownMenu = Object.assign(RadixDropdownMenu.Root, {
  Trigger: RadixDropdownMenu.Trigger,
  Content,
  Item,
  Label,
  Separator,
  RadioGroup: RadixDropdownMenu.RadioGroup,
  RadioItem,
})
