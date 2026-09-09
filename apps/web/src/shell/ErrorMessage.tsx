import { useTranslation } from 'react-i18next'
import { ApiError, type ClientErrorCode } from '../api/client'

export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation('errors')

  if (error === null || error === undefined) return null

  const code: ClientErrorCode = error instanceof ApiError ? error.code : 'common.unexpected'
  const params = error instanceof ApiError ? error.params : {}

  // react-i18next's typed `t` only accepts a fully dynamic string key when the
  // call also supplies `defaultValue` — supplying the code itself keeps the
  // key argument checked against ClientErrorCode with no cast at all, and the
  // default is unreachable in practice: every code in the registry has a
  // translation in both bundles (enforced by locales.test.ts and i18n:check).
  return (
    <p role="alert" className="text-sm text-red-700">
      {t(code, { ...(params as Record<string, string>), defaultValue: code })}
    </p>
  )
}
