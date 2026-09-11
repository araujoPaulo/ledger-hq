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

  if (!envelope.data || !envelope.data.setUp) {
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
          .catch(() => setError(t('unlock.wrongPassword')))
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
