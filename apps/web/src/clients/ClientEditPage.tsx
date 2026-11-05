import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { UpdateClientInput } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { getClient, updateClient } from './api'
import { ClientForm } from './ClientForm'
import { ClientFormSkeleton } from './ClientFormSkeleton'

/** `/clients/$clientId/edit`. */
export function ClientEditPage() {
  const { clientId } = useParams({ from: '/clients/$clientId/edit' })
  const { t } = useTranslation('clients')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // The detail page's own key, so arriving from it is instant.
  const client = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => getClient(clientId),
  })

  const mutation = useMutation({
    mutationFn: (input: UpdateClientInput) => updateClient(clientId, input),
    onSuccess: async () => {
      // The detail page reads ['client', id] and the list ['clients', …];
      // both would otherwise show the old values until their staleTime ran out.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['client', clientId] }),
        queryClient.invalidateQueries({ queryKey: ['clients'] }),
      ])
      await navigate({ to: '/clients/$clientId', params: { clientId } })
    },
  })

  // Data first: TanStack keeps `data` when a background refetch fails (status
  // 'error'), and unmounting the form then would discard the user's edits.
  if (client.data === undefined) {
    if (!client.isError) return <ClientFormSkeleton />
    return (
      <div className="flex flex-col gap-4">
        <Link
          to="/clients"
          className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-muted hover:text-ink"
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          {t('title')}
        </Link>
        <ErrorMessage error={client.error} />
      </div>
    )
  }

  // An archived client's edit URL still renders the form: the server refuses
  // the save with clients.archived, and its message is the guard (spec §6.2).
  return (
    <ClientForm
      key={client.data.id}
      mode="edit"
      initial={client.data}
      onSubmit={(input) => mutation.mutate(input)}
      isPending={mutation.isPending}
      error={mutation.error}
    />
  )
}
