import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, Plus, RefreshCw } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatQuarter } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Button, Callout, Dialog, EmptyState } from '../ui'
import { generateObligations, listObligations, patchObligation } from './api'
import type { ObligationResponse } from './api'
import { AdjustObligationForm } from './AdjustObligationForm'
import { AddAdHocObligationForm } from './AddAdHocObligationForm'
import { ObligationAttachments } from './ObligationAttachments'
import { ObligationRow } from './ObligationRow'
import { ObligationsSectionSkeleton } from './ObligationsSectionSkeleton'

export function ObligationsSection({ clientId }: { clientId: string }) {
  const { t, i18n } = useTranslation('obligations')
  const locale = i18n.language as SupportedLocale
  const queryClient = useQueryClient()
  const titleId = useId()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ObligationResponse | null>(null)
  const [attachmentsFor, setAttachmentsFor] = useState<ObligationResponse | null>(null)

  const obligations = useQuery({
    queryKey: ['obligations', clientId],
    queryFn: () => listObligations({ clientId }),
  })

  const preview = useQuery({
    queryKey: ['obligations-preview', clientId],
    queryFn: () => generateObligations({ clientId }, true),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['obligations', clientId] })

  const markDone = useMutation({
    mutationFn: (id: string) => patchObligation(id, { status: 'DONE' }),
    onSuccess: invalidate,
  })

  const apply = useMutation({
    mutationFn: () => generateObligations({ clientId }, false),
    onSuccess: async () => {
      await invalidate()
      // Applying just resolved every previewed change: set the preview data
      // directly to empty rather than invalidating it, so we don't issue a
      // redundant dry-run request immediately after the apply request.
      queryClient.setQueryData(['obligations-preview', clientId], { toCreate: [], toRetract: [] })
    },
  })

  const hasPendingChanges = (preview.data?.toCreate.length ?? 0) > 0 || (preview.data?.toRetract.length ?? 0) > 0

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id={titleId} className="text-base font-semibold">
          {t('section.title')}
        </h2>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          {t('adHoc.newTitle')}
        </Button>
      </div>

      {hasPendingChanges && preview.data && (
        <Callout
          tone="warning"
          icon={RefreshCw}
          action={
            <Button variant="primary" size="sm" isLoading={apply.isPending} onClick={() => apply.mutate()}>
              {t('section.apply')}
            </Button>
          }
        >
          {t('section.previewMessage', {
            toCreate: preview.data.toCreate.length,
            toRetract: preview.data.toRetract.length,
          })}
        </Callout>
      )}

      <ErrorMessage error={apply.error} />
      <ErrorMessage error={preview.error} />
      <ErrorMessage error={markDone.error} />

      {obligations.isPending ? (
        <ObligationsSectionSkeleton />
      ) : obligations.isError ? (
        <ErrorMessage error={obligations.error} />
      ) : obligations.data.length === 0 ? (
        <EmptyState icon={CalendarCheck} title={t('section.empty')} description={t('section.emptyHint')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {obligations.data.map((obligation) => (
            <ObligationRow
              key={obligation.id}
              obligation={obligation}
              showClient={false}
              onMarkDone={() => markDone.mutate(obligation.id)}
              onEdit={() => setEditing(obligation)}
              onManageAttachments={() => setAttachmentsFor(obligation)}
            />
          ))}
        </ul>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <Dialog.Content title={t('adHoc.newTitle')}>
          <AddAdHocObligationForm
            clientId={clientId}
            onCreated={() => {
              void invalidate()
              setCreating(false)
            }}
          />
        </Dialog.Content>
      </Dialog>

      {/* Opened from a row, not a trigger: Radix returns focus to whatever was
          focused when it opened — the row's own button. */}
      {editing !== null && (
        <Dialog open onOpenChange={(open) => (open ? undefined : setEditing(null))}>
          <Dialog.Content title={`${editing.definitionName} — ${formatQuarter(editing.periodLabel, locale)}`}>
            <AdjustObligationForm
              obligation={editing}
              onSaved={() => {
                void invalidate()
                setEditing(null)
              }}
            />
          </Dialog.Content>
        </Dialog>
      )}

      {attachmentsFor !== null && (
        <Dialog open onOpenChange={(open) => (open ? undefined : setAttachmentsFor(null))}>
          <Dialog.Content title={`${t('attachments.title')} — ${attachmentsFor.definitionName}`}>
            <ObligationAttachments obligation={attachmentsFor} />
          </Dialog.Content>
        </Dialog>
      )}
    </section>
  )
}
