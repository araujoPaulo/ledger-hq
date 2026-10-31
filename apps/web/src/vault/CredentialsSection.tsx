import { useEffect, useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { KeyRound, Lock, Plus } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Card, Dialog, EmptyState, Skeleton } from '../ui'
import { listCredentialsForClient, listPlatforms } from './api'
import type { PlatformResponse } from './api'
import { AddCredentialForm } from './AddCredentialForm'
import { CredentialRow } from './CredentialRow'
import { listCachedCredentials, listCachedPlatforms } from './vault-db'
import { VaultUnlockGate } from './VaultUnlockGate'
import { lockVault, useVaultState } from './vault-session'

/** The gate or the list, never both. The header's actions exist only once unlocked. */
export function CredentialsSection({ clientId }: { clientId: string }) {
  const { t } = useTranslation(['vault', 'common'])
  const titleId = useId()
  const vaultState = useVaultState()
  const [creating, setCreating] = useState(false)

  // Same lock signal CredentialRow uses: a dialog left open by an auto-lock
  // must not reopen on its own after the next unlock.
  useEffect(() => {
    if (vaultState.status === 'locked') setCreating(false)
  }, [vaultState.status])

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id={titleId} className="text-base font-semibold">
          {t('vault:credentials.title')}
        </h2>
        {vaultState.status === 'unlocked' && (
          <div className="flex items-center gap-2">
            {/* The account menu's own action, closer to where the secrets are. */}
            <Button variant="ghost" size="sm" onClick={() => lockVault()}>
              <Lock aria-hidden="true" className="h-3.5 w-3.5" />
              {t('common:actions.lockVault')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              {t('vault:credentials.newTitle')}
            </Button>
          </div>
        )}
      </div>
      <VaultUnlockGate>
        <CredentialsList clientId={clientId} creating={creating} onCreatingChange={setCreating} />
      </VaultUnlockGate>
    </section>
  )
}

type ListProps = { clientId: string; creating: boolean; onCreatingChange: (open: boolean) => void }

function CredentialsList({ clientId, creating, onCreatingChange }: ListProps) {
  const { t } = useTranslation('vault')
  const queryClient = useQueryClient()

  const credentials = useQuery({
    queryKey: ['credentials', clientId],
    // Falls back to the durable IndexedDB cache (Task 11) when the network
    // is unreachable, the same catch-based shape `resolveEnvelope` already
    // uses for the vault envelope — offline reads must not depend solely on
    // the generic HTTP cache's 24-hour window.
    queryFn: async () => {
      try {
        return await listCredentialsForClient(clientId)
      } catch {
        return listCachedCredentials(clientId)
      }
    },
  })
  const platforms = useQuery({
    queryKey: ['platforms'],
    queryFn: async () => {
      try {
        return await listPlatforms()
      } catch {
        return (await listCachedPlatforms()) as PlatformResponse[]
      }
    },
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['credentials', clientId] })

  function platformName(platformId: string): string {
    return platforms.data?.find((platform) => platform.id === platformId)?.name ?? platformId
  }

  return (
    <>
      {credentials.isPending || platforms.isPending ? (
        <Card padding="none" className="flex flex-col px-5" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex min-h-[56px] items-center gap-4 border-b border-line py-3 last:border-b-0">
              <Skeleton width="2rem" height="2rem" />
              <Skeleton width="12rem" height="0.875rem" />
            </div>
          ))}
        </Card>
      ) : credentials.isError ? (
        <ErrorMessage error={credentials.error} />
      ) : credentials.data.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={t('credentials.empty')}
          action={
            <Button variant="primary" onClick={() => onCreatingChange(true)}>
              {t('credentials.newTitle')}
            </Button>
          }
        />
      ) : (
        <Card padding="none">
          <ul className="flex flex-col divide-y divide-line">
            {credentials.data.map((credential) => (
              <CredentialRow
                key={credential.id}
                credential={credential}
                platformName={platformName(credential.platformId)}
                onRotated={() => void invalidate()}
              />
            ))}
          </ul>
        </Card>
      )}

      <Dialog open={creating} onOpenChange={onCreatingChange}>
        <Dialog.Content title={t('credentials.newTitle')}>
          {platforms.data === undefined || platforms.data.length === 0 ? (
            <p className="text-sm text-muted">{t('platforms.empty')}</p>
          ) : (
            <AddCredentialForm
              clientId={clientId}
              platforms={platforms.data}
              onCreated={() => {
                onCreatingChange(false)
                void invalidate()
              }}
            />
          )}
        </Dialog.Content>
      </Dialog>
    </>
  )
}
