import type { ComponentProps } from 'react'
import { ChevronDown } from 'lucide-react'
import { Field, controlBox } from './Field'
import type { FieldProps } from './Field'

/**
 * `layout="inline"` puts the label beside the control — filter bars only. A
 * filter has neither a hint nor an error, so the type forbids both there.
 */
type LayoutProps =
  | { layout?: 'stacked'; hint?: string | undefined; error?: string | undefined }
  | { layout: 'inline'; hint?: never; error?: never }

export type SelectProps = ComponentProps<'select'> & Pick<FieldProps, 'label' | 'hideLabel'> & LayoutProps

/**
 * A native `<select>`, styled (spec §2.1): the phone's own picker, real form
 * participation, and `userEvent.selectOptions` in tests. Options are
 * `<option>` children, built at the call site from a `*_VALUES` constant.
 */
export function Select({
  label,
  hideLabel,
  hint,
  error,
  layout = 'stacked',
  id,
  'aria-describedby': describedBy,
  className,
  children,
  ...rest
}: SelectProps) {
  return (
    <Field
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error}
      id={id}
      describedBy={describedBy}
      layout={layout}
    >
      {(control) => (
        <div className="relative">
          <select
            {...rest}
            {...control}
            className={[
              controlBox({ invalid: error !== undefined }),
              'h-10 appearance-none pl-3 pr-9',
              layout === 'stacked' ? 'w-full' : null,
              className ?? null,
            ]
              .filter((value) => value !== null)
              .join(' ')}
          >
            {children}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
          />
        </div>
      )}
    </Field>
  )
}
