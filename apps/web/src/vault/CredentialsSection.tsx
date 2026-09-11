import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { listCredentialsForClient, listPlatforms } from './api'
import { AddCredentialForm } from './AddCredentialForm'
import { CredentialRow } from './CredentialRow'
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
    queryFn: () => listCredentialsForClient(clientId),
  })
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: listPlatforms })

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

      <AddCredentialForm
        clientId={clientId}
        platforms={platforms.data ?? []}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['credentials', clientId] })}
      />
    </div>
  )
}
