import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MIN_MASTER_PASSWORD_LENGTH } from '@ledger-hq/crypto'
import { ErrorMessage } from '../shell/ErrorMessage'
import { createAccount } from './credentials'
import { SESSION_QUERY_KEY } from './session'

export function SetupPage() {
  const { t, i18n } = useTranslation('common')
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [masterPassword, setMasterPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const passwordsMismatch = confirmPassword.length > 0 && masterPassword !== confirmPassword
  // Argon2id's salt (the raw master password, in `deriveAuthHash`) throws
  // below 8 bytes — refuse before any derivation runs, the same way the
  // mismatch check above refuses before a submit.
  const passwordTooShort = masterPassword.length > 0 && masterPassword.length < MIN_MASTER_PASSWORD_LENGTH

  const mutation = useMutation({
    mutationFn: () => createAccount(email, masterPassword, i18n.language as 'pt-PT' | 'en-GB'),
    onSuccess: async () => {
      setMasterPassword('')
      setConfirmPassword('')
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
      await queryClient.invalidateQueries({ queryKey: ['bootstrap-required'] })
    },
  })

  return (
    <form
      className="mx-auto flex max-w-sm flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (passwordsMismatch || passwordTooShort) return
        mutation.mutate()
      }}
    >
      <h1 className="text-lg font-semibold">{t('auth.setupTitle')}</h1>

      <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
        {t('auth.recoveryWarning')}
      </p>

      <label className="flex flex-col gap-1 text-sm">
        {t('auth.emailLabel')}
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('auth.masterPasswordLabel')}
        <input
          type="password"
          autoComplete="new-password"
          required
          value={masterPassword}
          onChange={(event) => setMasterPassword(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('auth.confirmPasswordLabel')}
        <input
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      {passwordTooShort && (
        <p role="alert" className="text-sm text-red-700">
          {t('auth.passwordTooShort', { min: MIN_MASTER_PASSWORD_LENGTH })}
        </p>
      )}

      {passwordsMismatch && (
        <p role="alert" className="text-sm text-red-700">
          {t('auth.passwordMismatch')}
        </p>
      )}

      <ErrorMessage error={mutation.error} />

      <button
        type="submit"
        disabled={mutation.isPending || passwordsMismatch || passwordTooShort}
        className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {t('actions.create')}
      </button>
    </form>
  )
}
