import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { useSession } from '../auth/session'
import { setUpVault } from './setup'

export function VaultSetupPage() {
  const { t } = useTranslation('vault')
  const session = useSession()
  const [masterPassword, setMasterPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  const mutation = useMutation({
    mutationFn: () => setUpVault(session.data?.email ?? '', masterPassword),
    onSuccess: (result) => setRecoveryCode(result.recoveryCode),
  })

  if (recoveryCode !== null) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-4">
        <h1 className="text-lg font-semibold">{t('setup.title')}</h1>
        <p className="text-sm">{t('setup.recoveryCodeIntro')}</p>
        <p className="rounded border border-amber-400 bg-amber-50 p-3 text-center font-mono text-sm text-amber-900">
          {recoveryCode}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          {t('setup.acknowledgeLabel')}
        </label>
        <button
          type="button"
          disabled={!acknowledged}
          onClick={() => window.history.back()}
          className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
        >
          {t('setup.continueButton')}
        </button>
      </div>
    )
  }

  return (
    <form
      className="mx-auto flex max-w-sm flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <h1 className="text-lg font-semibold">{t('setup.title')}</h1>

      <label className="flex flex-col gap-1 text-sm">
        {t('setup.confirmPasswordLabel')}
        <input
          type="password"
          autoComplete="current-password"
          required
          value={masterPassword}
          onChange={(event) => setMasterPassword(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <ErrorMessage error={mutation.error} />

      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {t('setup.continueButton')}
      </button>
    </form>
  )
}
