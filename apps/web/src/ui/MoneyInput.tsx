import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Euro } from 'lucide-react'
import { formatAmount, parseAmount } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Input } from './Input'
import type { InputProps } from './Input'

export type MoneyInputProps = Omit<
  InputProps,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'inputMode' | 'leadingIcon'
> & {
  defaultCents?: number | null | undefined
  /** Cents on every change, or `null` when the text is empty or not an amount. */
  onValueChange: (cents: number | null) => void
}

/**
 * An amount typed in euros, in the locale's own notation; the parent only
 * ever sees integer cents. The text is the component's state — a form resets
 * it by changing the `key`, or by unmounting it with its dialog.
 *
 * Whether an amount must be positive is the form's rule, not this
 * component's.
 */
export function MoneyInput({ defaultCents, onValueChange, onBlur, error, className, ...rest }: MoneyInputProps) {
  const { t, i18n } = useTranslation('common')
  const locale = i18n.language as SupportedLocale

  const [text, setText] = useState(() =>
    defaultCents === null || defaultCents === undefined ? '' : formatAmount(defaultCents, locale),
  )
  // Typing is never interrupted: the format error waits for the field to be left.
  const [blurred, setBlurred] = useState(false)

  const cents = parseAmount(text, locale)
  const formatError = blurred && text.trim() !== '' && cents === null ? t('money.invalid') : undefined

  return (
    <Input
      {...rest}
      className={['tabular-nums', className].filter(Boolean).join(' ')}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      leadingIcon={Euro}
      value={text}
      error={error ?? formatError}
      onChange={(event) => {
        setText(event.target.value)
        setBlurred(false)
        onValueChange(parseAmount(event.target.value, locale))
      }}
      onBlur={(event) => {
        setBlurred(true)
        // A rewrite of the same amount, not a new value — so no onValueChange,
        // or leaving the field would retract a payment proposal.
        if (cents !== null) setText(formatAmount(cents, locale))
        onBlur?.(event)
      }}
    />
  )
}
