import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MIN_MASTER_PASSWORD_LENGTH } from '@ledger-hq/crypto'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Input } from '../ui'
import { recoverVault } from '../vault/recover'
import { caretInFormatted, formatRecoveryCode, significantBefore } from '../vault/recoveryCode'
import { CardHeading } from './CardHeading'
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

  // Formatting the code re-groups it, which moves characters across hyphens.
  // The caret index computed in onChange is applied after React writes the
  // new value, so the next keystroke lands where the reader is typing.
  const recoveryCodeRef = useRef<HTMLInputElement>(null)
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return
    recoveryCodeRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  })

  // Switching modes unmounts the focused button; hand focus to the new card's
  // heading so keyboard and screen-reader users land at the top of the form.
  const headingRef = useRef<HTMLHeadingElement>(null)
  const modeChanged = useRef(false)
  useEffect(() => {
    if (!modeChanged.current) return
    headingRef.current?.focus()
  }, [mode])
  const switchMode = (next: 'login' | 'recover') => {
    modeChanged.current = true
    setMode(next)
  }

  const tooShortMessage = t('auth.passwordTooShort', { min: MIN_MASTER_PASSWORD_LENGTH })

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
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (newPasswordTooShort || newPasswordsMismatch) return
          recoverMutation.mutate()
        }}
      >
        <CardHeading ref={headingRef} title={t('auth.recoverTitle')} intro={t('auth.recoverIntro')} />

        {/*
         * No maxLength: it would cut a pasted code with extra spacing before
         * formatRecoveryCode could normalise it. The formatter caps the code.
         */}
        <Input
          ref={recoveryCodeRef}
          label={t('auth.recoveryCodeLabel')}
          hint={t('auth.recoveryCodeHint')}
          required
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          className="font-mono tracking-wider"
          value={recoveryCode}
          onChange={(event) => {
            const { selectionStart } = event.target
            let { value } = event.target
            const formattedBefore = formatRecoveryCode(value)
            if (
              formattedBefore === recoveryCode &&
              (event.nativeEvent as InputEvent).inputType === 'deleteContentForward'
            ) {
              // Forward Delete right before a hyphen removed only the hyphen,
              // which the formatter puts straight back. Delete the next code
              // character instead, leaving the caret where it was.
              const at = selectionStart ?? value.length
              value = value.slice(0, at) + value.slice(at + 1)
            }
            const formatted = formatRecoveryCode(value)
            const caret = caretInFormatted(formatted, significantBefore(value, selectionStart ?? value.length))
            if (formatted === recoveryCode) {
              // State is unchanged, so React will not re-render and the layout
              // effect would never run: React would restore the DOM value and
              // push the caret to the end. Put both back by hand instead.
              event.target.value = formatted
              event.target.setSelectionRange(caret, caret)
              pendingCaret.current = null
              return
            }
            pendingCaret.current = caret
            setRecoveryCode(formatted)
          }}
        />

        <Input
          type="password"
          autoComplete="new-password"
          required
          label={t('auth.newMasterPasswordLabel')}
          value={newMasterPassword}
          onChange={(event) => setNewMasterPassword(event.target.value)}
          error={newPasswordTooShort ? tooShortMessage : undefined}
        />

        <Input
          type="password"
          autoComplete="new-password"
          required
          label={t('auth.confirmNewMasterPasswordLabel')}
          value={confirmNewMasterPassword}
          onChange={(event) => setConfirmNewMasterPassword(event.target.value)}
          error={newPasswordsMismatch ? t('auth.passwordMismatch') : undefined}
        />

        <ErrorMessage error={recoverMutation.error} />

        <Button
          type="submit"
          variant="primary"
          className="w-full"
          isLoading={recoverMutation.isPending}
          disabled={newPasswordTooShort || newPasswordsMismatch}
        >
          {t('auth.recoverButton')}
        </Button>

        <Button variant="ghost" size="sm" className="self-center" onClick={() => switchMode('login')}>
          {t('auth.backToLogin')}
        </Button>
      </form>
    )
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (passwordTooShort) return
        loginMutation.mutate()
      }}
    >
      <CardHeading ref={headingRef} title={t('auth.loginTitle')} />

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
        autoComplete="current-password"
        required
        label={t('auth.masterPasswordLabel')}
        value={masterPassword}
        onChange={(event) => setMasterPassword(event.target.value)}
        error={passwordTooShort ? tooShortMessage : undefined}
      />

      <ErrorMessage error={loginMutation.error} />

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        isLoading={loginMutation.isPending}
        disabled={passwordTooShort}
      >
        {t('actions.signIn')}
      </Button>

      <Button variant="ghost" size="sm" className="self-center" onClick={() => switchMode('recover')}>
        {t('auth.forgotPassword')}
      </Button>
    </form>
  )
}
