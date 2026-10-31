import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'
import { Button, DropdownMenu } from '../ui'
import { SUPPORTED_LOCALES, setLocale } from '../i18n'
import type { SupportedLocale } from '../i18n'

/**
 * The language list, once. Rendered inside the account menu when signed in
 * and inside `LanguageMenu` on the signed-out screens.
 */
export function LanguageRadioItems() {
  const { t, i18n } = useTranslation('common')

  return (
    <DropdownMenu.RadioGroup value={i18n.language} onValueChange={(value) => void setLocale(value as SupportedLocale)}>
      {SUPPORTED_LOCALES.map((locale) => (
        <DropdownMenu.RadioItem key={locale} value={locale}>
          {t(`language.${locale}`)}
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  )
}

/**
 * The signed-out screens' language control. Account setup records the active
 * language as the account's locale, so it must be reachable before there is
 * an account to open a menu for.
 */
export function LanguageMenu() {
  const { t } = useTranslation('common')

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('language.label')}>
          <Languages aria-hidden="true" className="h-4 w-4" />
        </Button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content>
        <DropdownMenu.Label>{t('language.label')}</DropdownMenu.Label>
        <LanguageRadioItems />
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}
