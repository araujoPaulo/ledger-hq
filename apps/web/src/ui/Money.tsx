import type { ComponentPropsWithoutRef } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCurrency } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'

type MoneyTone = 'auto' | 'credit' | 'debit' | 'writtenOff'

const TONE_CLASS: Record<Exclude<MoneyTone, 'auto'>, string> = {
  credit: 'text-success-700',
  debit: 'text-ink',
  writtenOff: 'text-subtle line-through',
}

const SIZE_CLASS = { sm: 'text-xs', md: 'text-sm', lg: 'text-2xl' } as const

type MoneyProps = ComponentPropsWithoutRef<'span'> & {
  cents: number
  tone?: MoneyTone
  size?: keyof typeof SIZE_CLASS
}

export function Money({ cents, tone = 'auto', size = 'md', className, ...rest }: MoneyProps) {
  // useTranslation, not i18next.language directly: this is what subscribes
  // the component to changeLanguage, so an amount reformats when the user
  // switches locale instead of keeping whichever locale was active at mount.
  const { i18n } = useTranslation()

  // `cents < 0` is false for -0, which is what keeps a negative zero from
  // rendering as a credit. Normalising -0 to 0 before formatting is what
  // keeps Intl from printing a minus sign in front of it.
  const resolved = tone === 'auto' ? (cents < 0 ? 'credit' : 'debit') : tone
  const amount = cents === 0 ? 0 : cents

  return (
    <span
      {...rest}
      className={`font-medium tabular-nums ${TONE_CLASS[resolved]} ${SIZE_CLASS[size]}${className === undefined ? '' : ` ${className}`}`}
    >
      {formatCurrency(amount, i18n.language as SupportedLocale)}
    </span>
  )
}
