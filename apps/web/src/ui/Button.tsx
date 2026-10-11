import type { ComponentPropsWithoutRef } from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { Slot } from '@radix-ui/react-slot'
import { Loader2 } from 'lucide-react'

const button = cva(
  'inline-flex items-center justify-center gap-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2 disabled:opacity-60 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        // Destructive actions are outlined, not filled: a red wall should
        // never be the loudest thing on a screen.
        primary: 'bg-accent-600 text-white border border-accent-600 hover:bg-accent-700',
        secondary: 'bg-surface text-ink border border-line-strong hover:bg-ground',
        ghost: 'bg-transparent text-muted border border-transparent hover:bg-ground',
        danger: 'bg-surface text-danger-700 border border-danger-700 hover:bg-danger-50',
      },
      size: {
        sm: 'rounded-control px-3 py-1.5 text-xs',
        md: 'rounded-surface px-4 py-2 text-sm',
        icon: 'rounded-control h-[34px] w-[34px] p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

type ButtonOwnProps = Omit<ComponentPropsWithoutRef<'button'>, 'type' | 'disabled'> & {
  variant?: NonNullable<VariantProps<typeof button>['variant']>
}

/**
 * `size="icon"` narrows the props to require an accessible name. An icon-only
 * button has no text for a screen reader to fall back on, and the type is the
 * only thing that catches the omission before it ships.
 */
type SizeProps = { size?: 'sm' | 'md' } | { size: 'icon'; 'aria-label': string }

/**
 * `asChild` renders the single child — a router `Link` — with the button's
 * classes instead of a `<button>`. An anchor has no `type`, a link does not
 * load, and a link that cannot be followed should not be rendered at all, so
 * the type forbids all three in that mode.
 */
type ModeProps =
  | {
      asChild?: false | undefined
      type?: 'button' | 'submit' | 'reset' | undefined
      disabled?: boolean | undefined
      isLoading?: boolean | undefined
    }
  | { asChild: true; type?: never; disabled?: never; isLoading?: never }

type ButtonProps = ButtonOwnProps & SizeProps & ModeProps

export function Button({
  variant,
  size,
  asChild = false,
  isLoading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = `${button({ variant, size })}${className === undefined ? '' : ` ${className}`}`

  if (asChild) {
    return (
      <Slot {...rest} className={classes}>
        {children}
      </Slot>
    )
  }

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled === true || isLoading}
      aria-busy={isLoading || undefined}
      className={classes}
    >
      {isLoading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}
