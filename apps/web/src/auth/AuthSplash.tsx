import { useTranslation } from 'react-i18next'
import { AuthFrame, AuthMark } from './AuthLayout'

/**
 * What shows while the session resolves — usually a few milliseconds. A
 * static mark, not a spinner: the card or the shell then replaces it in
 * place, which reads as one screen rather than a flash.
 */
export function AuthSplash() {
  const { t } = useTranslation('common')

  return (
    <AuthFrame busy>
      <AuthMark />
      <span role="status" className="sr-only">{t('loading')}</span>
    </AuthFrame>
  )
}
