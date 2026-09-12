import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { listCredentialsForClient, listPlatforms } from './api'
import type { PlatformResponse } from './api'
import { AddCredentialForm } from './AddCredentialForm'
import { CredentialRow } from './CredentialRow'
import { listCachedCredentials, listCachedPlatforms } from './vault-db'
import { VaultUnlockGate } from './VaultUnlockGate'

export function CredentialsSection({ clientId }: { clientId: string }) {
  const { t } = useTranslation('vault')

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t('credentials.title')}</h2>
      <VaultUnlockGate>
        <CredentialsList clientId={clientId} />
      </VaultUnlockGate>
    </section>
  )
}

function CredentialsList({ clientId }: { clientId: string }) {
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

  function platformName(platformId: string): string {
    return platforms.data?.find((platform) => platform.id === platformId)?.name ?? platformId
  }

  return (
    <div className="flex flex-col gap-3">
      {credentials.isPending || platforms.isPending ? null : credentials.isError ? (
        <ErrorMessage error={credentials.error} />
      ) : credentials.data.length === 0 ? (
        <p className="text-sm text-slate-600">{t('credentials.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {credentials.data.map((credential) => (
            <CredentialRow
              key={credential.id}
              credential={credential}
              platformName={platformName(credential.platformId)}
              onRotated={() => queryClient.invalidateQueries({ queryKey: ['credentials', clientId] })}
            />
          ))}
        </ul>
      )}

      {platforms.isSuccess && (
        <AddCredentialForm
          clientId={clientId}
          platforms={platforms.data}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['credentials', clientId] })}
        />
      )}
    </div>
  )
}
