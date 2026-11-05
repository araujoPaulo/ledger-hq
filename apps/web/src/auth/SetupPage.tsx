import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MIN_MASTER_PASSWORD_LENGTH } from '@ledger-hq/crypto'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Input } from '../ui'
import { CardHeading } from './CardHeading'
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
    // The account's locale is whatever language is active at submit — which
    // is why the auth layout keeps the language menu on this screen.
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
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (passwordsMismatch || passwordTooShort) return
        mutation.mutate()
      }}
    >
      <CardHeading title={t('auth.setupTitle')} intro={t('auth.setupIntro')} />

      <Input
        type="email"
        autoComplete="username"
        required
        label={t('auth.emailLabel')}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <Input
        type="password"
        autoComplete="new-password"
        required
        label={t('auth.masterPasswordLabel')}
        hint={t('auth.passwordHint', { min: MIN_MASTER_PASSWORD_LENGTH })}
        value={masterPassword}
        onChange={(event) => setMasterPassword(event.target.value)}
        error={passwordTooShort ? t('auth.passwordTooShort', { min: MIN_MASTER_PASSWORD_LENGTH }) : undefined}
      />

      <Input
        type="password"
        autoComplete="new-password"
        required
        label={t('auth.confirmPasswordLabel')}
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        error={passwordsMismatch ? t('auth.passwordMismatch') : undefined}
      />

      <ErrorMessage error={mutation.error} />

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        isLoading={mutation.isPending}
        disabled={passwordsMismatch || passwordTooShort}
      >
        {t('actions.create')}
      </Button>
    </form>
  )
}
