import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources as en } from './locales/en'
import { resources as pt } from './locales/pt'

export const SUPPORTED_LOCALES = ['pt-PT', 'en-GB'] as const

// Declared once in ./format and re-exported here, so the two modules cannot
// drift into two incompatible unions with the same name.
export type { SupportedLocale } from './format'
import type { SupportedLocale } from './format'

const STORAGE_KEY = 'lhq_locale'

function initialLocale(): SupportedLocale {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'pt-PT' || stored === 'en-GB') return stored

  return navigator.language.startsWith('en') ? 'en-GB' : 'pt-PT'
}

export async function initI18n(): Promise<void> {
  await i18next.use(initReactI18next).init({
    resources: { 'pt-PT': pt, 'en-GB': en },
    lng: initialLocale(),
    fallbackLng: 'pt-PT',
    defaultNS: 'common',
    interpolation: { escapeValue: false },
  })

  document.documentElement.lang = i18next.language
}

export async function setLocale(locale: SupportedLocale): Promise<void> {
  localStorage.setItem(STORAGE_KEY, locale)
  await i18next.changeLanguage(locale)
  document.documentElement.lang = locale
}
