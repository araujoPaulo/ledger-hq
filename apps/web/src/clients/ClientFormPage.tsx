import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { CreateClientInput } from '@ledger-hq/domain'
import { createClient } from './api'
import { ClientForm } from './ClientForm'

/** `/clients/new`. Keeps its name: the router imports it. */
export function ClientFormPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (input: CreateClientInput) => createClient(input),
    onSuccess: async (client) => {
      // Without this, the list page's cached (now-stale) result — fetched
      // before this client existed — is still within its 30s staleTime on
      // the next visit, so it renders "no clients yet" for up to half a
      // minute after creating one. Every other mutation that changes what
      // the list would show (archive, restore) already invalidates it.
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      await navigate({ to: '/clients/$clientId', params: { clientId: client.id } })
    },
  })

  return (
    <ClientForm
      mode="create"
      onSubmit={(input) => mutation.mutate(input)}
      isPending={mutation.isPending}
      error={mutation.error}
    />
  )
}
