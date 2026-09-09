import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'

export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation('errors')

  if (error === null || error === undefined) return null

  const code = error instanceof ApiError ? error.code : 'common.unexpected'
  const params = error instanceof ApiError ? error.params : {}

  return (
    <p role="alert" className="text-sm text-red-700">
      {t(code as never, params as Record<string, string>)}
    </p>
  )
}
