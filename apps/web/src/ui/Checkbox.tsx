import { useId } from 'react'
import type { ComponentProps } from 'react'

export type CheckboxProps = Omit<ComponentProps<'input'>, 'type'> & {
  label: string
  description?: string | undefined
  /** A 40px bordered box, level with `Input` and `Select` in a filter bar. */
  boxed?: boolean | undefined
}

const labelBase =
  'flex cursor-pointer items-center gap-2 text-sm font-medium has-disabled:cursor-not-allowed has-disabled:text-subtle'

/**
 * A native checkbox in the accent colour, label to its right. The label wraps
 * the input, so the whole label is the click target. The description sits
 * outside it so it never becomes part of the accessible name.
 */
export function Checkbox({
  label,
  description,
  boxed = false,
  id,
  'aria-describedby': describedBy,
  className,
  ...rest
}: CheckboxProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const descriptionId = `${inputId}-description`
  const describedByIds = [description !== undefined ? descriptionId : null, describedBy ?? null]
    .filter((value): value is string => value !== null && value !== '')
    .join(' ')

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className={
          boxed ? `${labelBase} h-10 rounded-surface border border-line-strong bg-surface px-3` : labelBase
        }
      >
        <input
          {...rest}
          id={inputId}
          type="checkbox"
          aria-describedby={describedByIds === '' ? undefined : describedByIds}
          className={`h-4 w-4 shrink-0 accent-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed${className === undefined ? '' : ` ${className}`}`}
        />
        {label}
      </label>
      {description !== undefined && (
        <p id={descriptionId} className="pl-6 text-xs font-normal text-muted">
          {description}
        </p>
      )}
    </div>
  )
}
