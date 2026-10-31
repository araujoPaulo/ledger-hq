import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { useSession } from '../auth/session'
import { Button, Callout, Card, Checkbox, Input, PageHeader } from '../ui'
import { RecoveryCodeDisplay } from './RecoveryCodeDisplay'
import { setUpVault } from './setup'

const TOTAL_STEPS = 2

export function VaultSetupPage() {
  const { t } = useTranslation('vault')
  const session = useSession()
  const queryClient = useQueryClient()
  const [masterPassword, setMasterPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  const mutation = useMutation({
    mutationFn: () => setUpVault(session.data?.email ?? '', masterPassword),
    onSuccess: (result) => {
      setMasterPassword('')
      // The unlock gate and the Vault page share this key, and either may
      // have cached "not set up" before this page ran. Removing it (rather
      // than invalidating a query that is disabled while unlocked) means the
      // next lock fetches a fresh answer instead of showing the stale one.
      queryClient.removeQueries({ queryKey: ['vault-envelope-resolved'] })
      setRecoveryCode(result.recoveryCode)
    },
  })

  const step = recoveryCode === null ? 1 : 2

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <PageHeader title={t('setup.title')} description={t('setup.step', { current: step, total: TOTAL_STEPS })} />

      {recoveryCode === null ? (
        <Card>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              mutation.mutate()
            }}
          >
            <p className="text-sm font-normal text-muted">{t('setup.intro')}</p>
            <Input
              type="password"
              autoComplete="current-password"
              required
              label={t('setup.confirmPasswordLabel')}
              value={masterPassword}
              onChange={(event) => setMasterPassword(event.target.value)}
            />
            <ErrorMessage error={mutation.error} />
            <Button variant="primary" type="submit" isLoading={mutation.isPending} className="w-full">
              {t('setup.continueButton')}
            </Button>
          </form>
        </Card>
      ) : (
        <Card className="flex flex-col gap-6">
          <Callout tone="warning" icon={TriangleAlert} title={t('setup.recoveryCodeTitle')}>
            {t('setup.recoveryCodeIntro')}
          </Callout>
          <RecoveryCodeDisplay code={recoveryCode} />
          <Checkbox
            label={t('setup.acknowledgeLabel')}
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          {/* Reached from a link, returns there. A direct visit with no
              history stays put — a known gap, out of this stage's scope. */}
          <Button variant="primary" className="w-full" disabled={!acknowledged} onClick={() => window.history.back()}>
            {t('setup.continueButton')}
          </Button>
        </Card>
      )}
    </div>
  )
}
