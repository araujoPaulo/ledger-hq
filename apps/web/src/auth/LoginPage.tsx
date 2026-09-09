import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { signIn } from './credentials'
import { SESSION_QUERY_KEY } from './session'

export function LoginPage() {
  const { t } = useTranslation('common')
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [masterPassword, setMasterPassword] = useState('')

  const mutation = useMutation({
    mutationFn: () => signIn(email, masterPassword),
    onSuccess: async () => {
      setMasterPassword('')
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    },
  })

  return (
    <form
      className="mx-auto flex max-w-sm flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
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

      <ErrorMessage error={mutation.error} />

      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {t('actions.signIn')}
      </button>
    </form>
  )
}
