import { useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { useSession } from '../auth/session'
import { resolveEnvelope, unlockWithPassword } from './unlock'
import { useVaultState } from './vault-session'

export function VaultUnlockGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('vault')
  const session = useSession()
  const email = session.data?.email ?? ''
  const vaultState = useVaultState()
  const [masterPassword, setMasterPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const envelope = useQuery({
    queryKey: ['vault-envelope-resolved', email],
    queryFn: () => resolveEnvelope(email),
    enabled: email !== '' && vaultState.status === 'locked',
  })

  if (vaultState.status === 'unlocked') return <>{children}</>
  if (envelope.isPending) return null

  // `resolveEnvelope` returns `null` only when it could not reach the server
  // AND nothing was ever cached — a fundamentally different situation from a
  // vault that was checked live and confirmed never set up. Collapsing both
  // into "not set up" tells a user with a genuinely configured vault, who
  // simply hasn't unlocked on this device before, that they need to set one
  // up — which they can't do offline anyway.
  if (envelope.data === null || envelope.data === undefined) {
    return (
      <p className="text-sm" role="status">
        {t('unlock.offlineUnknown')}
      </p>
    )
  }

  if (!envelope.data.setUp) {
    return (
      <p className="text-sm">
        {t('unlock.notSetUp')}{' '}
        <Link to="/vault/setup" className="underline">
          {t('unlock.setUpLink')}
        </Link>
      </p>
    )
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setPending(true)
        setError(null)
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
            if (message === 'vault not set up') setError(t('unlock.notSetUp'))
            else if (message === 'vault unknown offline') setError(t('unlock.offlineUnknown'))
            else setError(t('unlock.wrongPassword'))
          })
          .finally(() => setPending(false))
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        {t('unlock.passwordLabel')}
        <input
          type="password"
          autoComplete="current-password"
          required
          value={masterPassword}
          onChange={(event) => setMasterPassword(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      {error !== null && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {t('unlock.unlockButton')}
      </button>
    </form>
  )
}
