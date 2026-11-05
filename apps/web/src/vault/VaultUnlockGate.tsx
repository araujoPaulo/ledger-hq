import { useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { Lock, ShieldAlert, WifiOff } from 'lucide-react'
import { useSession } from '../auth/session'
import { Button, Callout, Card, Input, Skeleton } from '../ui'
import { resolveEnvelope, unlockWithPassword } from './unlock'
import { INACTIVITY_LOCK_MS, useVaultState } from './vault-session'

export function VaultUnlockGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('vault')
  const session = useSession()
  const email = session.data?.email ?? ''
  const vaultState = useVaultState()
  const [masterPassword, setMasterPassword] = useState('')
  // Only a wrong password belongs on the password field; the other two submit
  // failures are not about what was typed and render apart from it.
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const envelope = useQuery({
    queryKey: ['vault-envelope-resolved', email],
    queryFn: () => resolveEnvelope(email),
    enabled: email !== '' && vaultState.status === 'locked',
  })

  if (vaultState.status === 'unlocked') return <>{children}</>
  if (envelope.isPending) {
    return (
      <div className="mx-auto w-full max-w-md">
        <Card aria-busy="true">
          <Skeleton height="10rem" />
        </Card>
      </div>
    )
  }

  // `resolveEnvelope` returns `null` only when it could not reach the server
  // AND nothing was ever cached — a fundamentally different situation from a
  // vault that was checked live and confirmed never set up. Collapsing both
  // into "not set up" tells a user with a genuinely configured vault, who
  // simply hasn't unlocked on this device before, that they need to set one
  // up — which they can't do offline anyway.
  if (envelope.data === null || envelope.data === undefined) {
    return (
      <Callout tone="warning" icon={WifiOff} role="status">
        {t('unlock.offlineUnknown')}
      </Callout>
    )
  }

  if (!envelope.data.setUp) {
    return (
      <Callout
        tone="neutral"
        icon={ShieldAlert}
        action={
          <Button asChild variant="primary" size="sm">
            <Link to="/vault/setup">{t('unlock.setUpLink')}</Link>
          </Button>
        }
      >
        {t('unlock.notSetUp')}
      </Callout>
    )
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="flex flex-col items-center gap-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ground text-muted">
          <Lock aria-hidden="true" className="h-6 w-6" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-base font-semibold">{t('unlock.lockedTitle')}</h3>
          <p className="text-sm font-normal text-muted">
            {t('unlock.lockedHint', { minutes: INACTIVITY_LOCK_MS / 60_000 })}
          </p>
        </div>
        <form
          className="flex w-full flex-col gap-4 text-left"
          onSubmit={(event) => {
            event.preventDefault()
            setPending(true)
            setPasswordError(null)
            setSubmitError(null)
            unlockWithPassword(email, masterPassword)
              .then(() => setMasterPassword(''))
              .catch((error: unknown) => {
                // `unlockWithPassword` throws two distinguishable, non-password
                // errors — see its own doc comment — on top of a genuine
                // wrong-password rejection (AES-KW's own integrity check).
                // Collapsing all three into "incorrect password" told a user
                // with no vault, or one who went offline between page load and
                // submit, that their (irrelevant) password was wrong.
                const message = error instanceof Error ? error.message : ''
                if (message === 'vault not set up') setSubmitError(t('unlock.notSetUp'))
                else if (message === 'vault unknown offline') setSubmitError(t('unlock.offlineUnknown'))
                else setPasswordError(t('unlock.wrongPassword'))
              })
              .finally(() => setPending(false))
          }}
        >
          <Input
            type="password"
            autoComplete="current-password"
            required
            label={t('unlock.passwordLabel')}
            value={masterPassword}
            onChange={(event) => setMasterPassword(event.target.value)}
            error={passwordError ?? undefined}
          />
          {submitError !== null && (
            <p role="alert" className="text-sm text-danger-700">
              {submitError}
            </p>
          )}
          <Button variant="primary" type="submit" isLoading={pending} className="w-full">
            {t('unlock.unlockButton')}
          </Button>
        </form>
      </Card>
    </div>
  )
}
