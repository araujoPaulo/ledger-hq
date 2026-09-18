import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { generateObligations, listObligations, patchObligation } from './api'
import type { ObligationResponse } from './api'
import { AdjustObligationForm } from './AdjustObligationForm'
import { AddAdHocObligationForm } from './AddAdHocObligationForm'
import { ObligationRow } from './ObligationRow'

export function ObligationsSection({ clientId }: { clientId: string }) {
  const { t } = useTranslation('obligations')
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ObligationResponse | null>(null)

  const obligations = useQuery({
    queryKey: ['obligations', clientId],
    queryFn: () => listObligations({ clientId }),
  })

  const preview = useQuery({
    queryKey: ['obligations-preview', clientId],
    queryFn: () => generateObligations({ clientId }, true),
  })

  const markDone = useMutation({
    mutationFn: (id: string) => patchObligation(id, { status: 'DONE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['obligations', clientId] }),
  })

  const apply = useMutation({
    mutationFn: () => generateObligations({ clientId }, false),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['obligations', clientId] })
      // Applying just resolved every previewed change: set the preview data
      // directly to empty rather than invalidating it, so we don't issue a
      // redundant dry-run request immediately after the apply request.
      queryClient.setQueryData(['obligations-preview', clientId], { toCreate: [], toRetract: [] })
    },
  })

  const hasPendingChanges = (preview.data?.toCreate.length ?? 0) > 0 || (preview.data?.toRetract.length ?? 0) > 0

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t('section.title')}</h2>

      {hasPendingChanges && preview.data && (
        <div className="flex items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <span>
            {t('section.previewMessage', {
              toCreate: preview.data.toCreate.length,
              toRetract: preview.data.toRetract.length,
            })}
          </span>
          <button
            type="button"
            onClick={() => apply.mutate()}
            disabled={apply.isPending}
            className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
          >
            {t('section.apply')}
          </button>
        </div>
      )}

      <ErrorMessage error={apply.error} />

      {obligations.isPending ? null : obligations.isError ? (
        <ErrorMessage error={obligations.error} />
      ) : obligations.data.length === 0 ? (
        <p className="text-sm text-slate-600">{t('section.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {obligations.data.map((obligation) => (
            <ObligationRow
              key={obligation.id}
              obligation={obligation}
              showClient={false}
              onMarkDone={() => markDone.mutate(obligation.id)}
              onEdit={() => setEditing(obligation)}
            />
          ))}
        </ul>
      )}

      {editing && (
        <AdjustObligationForm
          obligation={editing}
          onClose={() => setEditing(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['obligations', clientId] })}
        />
      )}

      <AddAdHocObligationForm
        clientId={clientId}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['obligations', clientId] })}
      />
    </section>
  )
}
