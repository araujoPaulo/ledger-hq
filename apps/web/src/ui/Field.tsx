import { useId } from 'react'
import type { ReactNode } from 'react'
import { cva } from 'class-variance-authority'
import { CircleAlert } from 'lucide-react'

/**
 * What every labelled control takes. Optional members admit `undefined`
 * explicitly, so a caller can pass `error={errors.get('name')}` under
 * `exactOptionalPropertyTypes`.
 */
export type FieldProps = {
  label: string
  /** Visually hidden, still the accessible name. A placeholder is never the label. */
  hideLabel?: boolean | undefined
  hint?: string | undefined
  error?: string | undefined
}

/** The ids `Field` hands its control, which tie label, hint and error to it. */
export type FieldControlProps = {
  id: string
  'aria-describedby': string | undefined
  'aria-invalid': true | undefined
}

/**
 * The box every text-like control shares: border, surface, focus ring and
 * the disabled treatment. Width, height and padding are each control's own,
 * so no control ever carries two utilities for one property.
 */
export const controlBox = cva(
  'rounded-surface border bg-surface text-sm text-ink placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 disabled:cursor-not-allowed disabled:border-line disabled:bg-ground disabled:text-subtle',
  {
    variants: { invalid: { true: 'border-danger-700', false: 'border-line-strong' } },
    defaultVariants: { invalid: false },
  },
)

type FieldRootProps = FieldProps & {
  /** The caller's own id, if any; otherwise one is generated. */
  id: string | undefined
  /** The caller's own aria-describedby, appended after the hint and the error. */
  describedBy: string | undefined
  layout?: 'stacked' | 'inline'
  children: (control: FieldControlProps) => ReactNode
}

/**
 * Label, hint and error for one control, so they behave identically on every
 * form. Internal to `ui/` — callers use `Input`, `Textarea` and `Select`.
 */
export function Field({
  label,
  hideLabel = false,
  hint,
  error,
  id,
  describedBy,
  layout = 'stacked',
  children,
}: FieldRootProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  const hintId = `${controlId}-hint`
  const errorId = `${controlId}-error`

  const describedByIds = [
    hint !== undefined ? hintId : null,
    error !== undefined ? errorId : null,
    describedBy ?? null,
  ]
    .filter((value): value is string => value !== null && value !== '')
    .join(' ')

  const control = children({
    id: controlId,
    'aria-describedby': describedByIds === '' ? undefined : describedByIds,
    'aria-invalid': error !== undefined ? true : undefined,
  })

  const labelClass = hideLabel
    ? 'sr-only'
    : `text-sm font-medium text-muted${layout === 'inline' ? ' whitespace-nowrap' : ''}`
  const labelElement = (
    <label htmlFor={controlId} className={labelClass}>
      {label}
    </label>
  )

  if (layout === 'inline') {
    return (
      <div className="flex items-center gap-2">
        {labelElement}
        {control}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {labelElement}
      {control}
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error !== undefined && (
        // The role existing field errors already carry: announced when it appears.
        <p id={errorId} role="alert" className="flex items-center gap-1.5 text-xs font-medium text-danger-700">
          <CircleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
