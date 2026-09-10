import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES, setLocale } from '../i18n'
import type { SupportedLocale } from '../i18n'

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common')

  return (
    <label className="text-sm">
      <span className="sr-only">{t('language.label')}</span>
      <select
        value={i18n.language}
        onChange={(event) => void setLocale(event.target.value as SupportedLocale)}
        className="rounded border border-slate-300 px-2 py-1"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {t(`language.${locale}`)}
          </option>
        ))}
      </select>
    </label>
  )
}
