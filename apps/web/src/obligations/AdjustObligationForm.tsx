import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { OBLIGATION_STATUS_VALUES } from '@ledger-hq/domain'
import type { ObligationStatus } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Dialog, Input, Select, Textarea } from '../ui'
import { patchObligation } from './api'
import type { ObligationResponse } from './api'

type Props = { obligation: ObligationResponse; onSaved: () => void }

/** Renders inside `Dialog.Content`; Cancel is the dialog's own close. */
export function AdjustObligationForm({ obligation, onSaved }: Props) {
  const { t } = useTranslation(['obligations', 'domain', 'common'])
  const [dueDate, setDueDate] = useState(obligation.dueDate)
  const [status, setStatus] = useState<ObligationStatus>(obligation.status as ObligationStatus)
  const [notes, setNotes] = useState(obligation.notes ?? '')

  const waivedWithoutReason = status === 'WAIVED' && notes.trim() === ''

  const mutation = useMutation({
    mutationFn: () =>
      patchObligation(obligation.id, {
        ...(dueDate !== obligation.dueDate ? { dueDate } : {}),
        ...(status !== obligation.status ? { status } : {}),
        // The server's WAIVED-requires-notes refine checks the payload, not
        // the stored row: omitting `notes` here because it didn't change
        // would 422 on an instance that already has notes, even though the
        // textarea visibly shows a reason. Always send it when waiving.
        ...(status === 'WAIVED' || notes !== (obligation.notes ?? '') ? { notes } : {}),
      }),
    onSuccess: onSaved,
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (waivedWithoutReason) return
        mutation.mutate()
      }}
    >
      <Input
        type="date"
        label={t('obligations:form.dueDate.label')}
        value={dueDate}
        onChange={(event) => setDueDate(event.target.value)}
      />
      <Select
        label={t('obligations:form.status.label')}
        value={status}
        onChange={(event) => setStatus(event.target.value as ObligationStatus)}
      >
        {OBLIGATION_STATUS_VALUES.map((value) => (
          <option key={value} value={value}>
            {t(`domain:obligationStatus.${value}`)}
          </option>
        ))}
      </Select>
      <Textarea
        label={t('obligations:form.notes.label')}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        error={waivedWithoutReason ? t('obligations:form.waiveReasonRequired') : undefined}
      />

      <ErrorMessage error={mutation.error} />

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="primary" type="submit" isLoading={mutation.isPending} disabled={waivedWithoutReason}>
          {t('common:actions.save')}
        </Button>
      </Dialog.Footer>
    </form>
  )
}
