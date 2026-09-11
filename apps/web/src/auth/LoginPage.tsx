import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MIN_MASTER_PASSWORD_LENGTH } from '@ledger-hq/crypto'
import { ErrorMessage } from '../shell/ErrorMessage'
import { recoverVault } from '../vault/recover'
import { signIn } from './credentials'
import { SESSION_QUERY_KEY } from './session'

export function LoginPage() {
  const { t } = useTranslation('common')
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'login' | 'recover'>('login')
  const [email, setEmail] = useState('')
  const [masterPassword, setMasterPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [newMasterPassword, setNewMasterPassword] = useState('')
  const [confirmNewMasterPassword, setConfirmNewMasterPassword] = useState('')

  const passwordTooShort = masterPassword.length > 0 && masterPassword.length < MIN_MASTER_PASSWORD_LENGTH

  const loginMutation = useMutation({
    mutationFn: () => signIn(email, masterPassword),
    onSuccess: async () => {
      setMasterPassword('')
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    },
  })

  const newPasswordTooShort =
    newMasterPassword.length > 0 && newMasterPassword.length < MIN_MASTER_PASSWORD_LENGTH
  const newPasswordsMismatch =
    confirmNewMasterPassword.length > 0 && newMasterPassword !== confirmNewMasterPassword

  const recoverMutation = useMutation({
    mutationFn: () => recoverVault(newMasterPassword, recoveryCode),
    onSuccess: async () => {
      setRecoveryCode('')
      setNewMasterPassword('')
      setConfirmNewMasterPassword('')
      setMode('login')
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    },
  })

  if (mode === 'recover') {
    return (
      <form
        className="mx-auto flex max-w-sm flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (newPasswordTooShort || newPasswordsMismatch) return
          recoverMutation.mutate()
        }}
      >
        <h1 className="text-lg font-semibold">{t('auth.recoverTitle')}</h1>

        <label className="flex flex-col gap-1 text-sm">
          {t('auth.recoveryCodeLabel')}
          <input
            required
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.target.value)}
            className="rounded border border-slate-300 px-2 py-1 font-mono"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t('auth.newMasterPasswordLabel')}
          <input
            type="password"
            autoComplete="new-password"
            required
            value={newMasterPassword}
            onChange={(event) => setNewMasterPassword(event.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t('auth.confirmNewMasterPasswordLabel')}
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirmNewMasterPassword}
            onChange={(event) => setConfirmNewMasterPassword(event.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>

        {newPasswordTooShort && (
          <p role="alert" className="text-sm text-red-700">
            {t('auth.passwordTooShort', { min: MIN_MASTER_PASSWORD_LENGTH })}
          </p>
        )}
        {newPasswordsMismatch && (
          <p role="alert" className="text-sm text-red-700">
            {t('auth.passwordMismatch')}
          </p>
        )}

        <ErrorMessage error={recoverMutation.error} />

        <button
          type="submit"
          disabled={recoverMutation.isPending || newPasswordTooShort || newPasswordsMismatch}
          className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
        >
          {t('auth.recoverButton')}
        </button>

        <button type="button" onClick={() => setMode('login')} className="text-sm underline">
          {t('auth.backToLogin')}
        </button>
      </form>
    )
  }

  return (
    <form
      className="mx-auto flex max-w-sm flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (passwordTooShort) return
        loginMutation.mutate()
      }}
    >
      <h1 className="text-lg font-semibold">{t('auth.loginTitle')}</h1>

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
          autoComplete="current-password"
          required
          value={masterPassword}
          onChange={(event) => setMasterPassword(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      {passwordTooShort && (
        <p role="alert" className="text-sm text-red-700">
          {t('auth.passwordTooShort', { min: MIN_MASTER_PASSWORD_LENGTH })}
        </p>
      )}

      <ErrorMessage error={loginMutation.error} />

      <button
        type="submit"
        disabled={loginMutation.isPending || passwordTooShort}
        className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {t('actions.signIn')}
      </button>

      <button type="button" onClick={() => setMode('recover')} className="text-sm underline">
        {t('auth.forgotPassword')}
      </button>
    </form>
  )
}
