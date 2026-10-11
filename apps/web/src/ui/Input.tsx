import type { ComponentProps } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Field, controlBox } from './Field'
import type { FieldProps } from './Field'

export type InputProps = ComponentProps<'input'> &
  FieldProps & {
    /** A 16px icon inside the left edge — search boxes. */
    leadingIcon?: LucideIcon | undefined
  }

/**
 * A labelled text input. `className` and `ref` land on the `<input>` — the
 * search box's `/` shortcut focuses through the ref. To override the 40px
 * height, use Tailwind's important modifier (`h-9!`).
 */
export function Input({
  label,
  hideLabel,
  hint,
  error,
  leadingIcon: Icon,
  id,
  'aria-describedby': describedBy,
  inputMode,
  className,
  ...rest
}: InputProps) {
  return (
    <Field label={label} hideLabel={hideLabel} hint={hint} error={error} id={id} describedBy={describedBy}>
      {(control) => {
        const input = (
          <input
            {...rest}
            {...control}
            inputMode={inputMode}
            className={[
              controlBox({ invalid: error !== undefined }),
              'h-10 w-full',
              Icon === undefined ? 'px-3' : 'pl-9 pr-3',
              inputMode === 'numeric' ? 'tabular-nums' : null,
              className ?? null,
            ]
              .filter((value) => value !== null)
              .join(' ')}
          />
        )

        if (Icon === undefined) return input

        return (
          <div className="relative">
            <Icon
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            />
            {input}
          </div>
        )
      }}
    </Field>
  )
}
