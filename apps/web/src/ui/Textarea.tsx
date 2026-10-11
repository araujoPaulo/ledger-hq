import type { ComponentProps } from 'react'
import { Field, controlBox } from './Field'
import type { FieldProps } from './Field'

export type TextareaProps = ComponentProps<'textarea'> & FieldProps

/** The `Input` treatment for prose: regular weight, grows downwards only. */
export function Textarea({
  label,
  hideLabel,
  hint,
  error,
  id,
  'aria-describedby': describedBy,
  className,
  ...rest
}: TextareaProps) {
  return (
    <Field label={label} hideLabel={hideLabel} hint={hint} error={error} id={id} describedBy={describedBy}>
      {(control) => (
        <textarea
          {...rest}
          {...control}
          className={[
            controlBox({ invalid: error !== undefined }),
            'min-h-24 w-full resize-y px-3 py-2.5 font-normal',
            className ?? null,
          ]
            .filter((value) => value !== null)
            .join(' ')}
        />
      )}
    </Field>
  )
}
