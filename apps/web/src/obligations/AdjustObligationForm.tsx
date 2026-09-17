import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { OBLIGATION_STATUS_VALUES } from '@ledger-hq/domain'
import type { ObligationStatus } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { patchObligation } from './api'
import type { ObligationResponse } from './api'

type Props = { obligation: ObligationResponse; onClose: () => void; onSaved: () => void }

export function AdjustObligationForm({ obligation, onClose, onSaved }: Props) {
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
        ...(notes !== (obligation.notes ?? '') ? { notes } : {}),
      }),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })

  return (
    <form
      className="flex flex-col gap-3 rounded border border-slate-200 bg-white p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (waivedWithoutReason) return
        mutation.mutate()
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:form.dueDate.label')}
        <input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:form.status.label')}
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as ObligationStatus)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          {OBLIGATION_STATUS_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`domain:obligationStatus.${value}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:form.notes.label')}
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      {waivedWithoutReason && (
        <p role="alert" className="text-sm text-red-700">
          {t('obligations:form.waiveReasonRequired')}
        </p>
      )}

      <ErrorMessage error={mutation.error} />

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={mutation.isPending || waivedWithoutReason}
          className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {t('common:actions.save')}
        </button>
        <button type="button" onClick={onClose} className="rounded border border-slate-300 px-3 py-2 text-sm">
          {t('common:actions.cancel')}
        </button>
      </div>
    </form>
  )
}
