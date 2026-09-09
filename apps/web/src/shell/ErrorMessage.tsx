import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { ApiError, type ClientErrorCode } from '../api/client'

/**
 * The one place ClientErrorCode's contract is enforced. react-i18next's
 * typed `t` only accepts a fully dynamic string key when the call also
 * supplies `defaultValue` — that overload (`TFunctionNonStrict`) types its
 * key parameter as a plain `string`, so `t()` itself performs no check of
 * the key at the call site below. The guard instead lives here, in this
 * function's own parameter type: any caller passing something that is not a
 * ClientErrorCode gets a compile error at its call site, regardless of
 * whether it bothers to annotate its own local variable. `defaultValue` is
 * unreachable in practice — every code in the registry has a translation in
 * both locale bundles (enforced by locales.test.ts and i18n:check).
 */
function translateErrorCode(
  t: TFunction<'errors'>,
  code: ClientErrorCode,
  params: Record<string, string> = {},
): string {
  return t(code, { ...params, defaultValue: code })
}

export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation('errors')

  if (error === null || error === undefined) return null

  const code = error instanceof ApiError ? error.code : 'common.unexpected'
  const params = error instanceof ApiError ? error.params : {}

  return (
    <p role="alert" className="text-sm text-red-700">
      {translateErrorCode(t, code, params as Record<string, string>)}
    </p>
  )
}
