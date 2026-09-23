import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { createAdHocCharge } from './api'

type Props = { clientId: string; onCreated: () => void }

export function AddAdHocChargeForm({ clientId, onCreated }: Props) {
  const { t } = useTranslation(['billing', 'common'])
  const titleId = useId()
  const [description, setDescription] = useState('')
  const [amountCents, setAmountCents] = useState('')
  const [dueOn, setDueOn] = useState('')

  const mutation = useMutation({
    mutationFn: () => createAdHocCharge({ clientId, description, amountCents: Number(amountCents), dueOn }),
    onSuccess: () => {
      setDescription('')
      setAmountCents('')
      setDueOn('')
      onCreated()
    },
  })

  return (
    <form
      aria-labelledby={titleId}
      className="flex max-w-sm flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <h3 id={titleId} className="font-medium">
        {t('billing:adHocCharge.newTitle')}
      </h3>

      <label className="flex flex-col gap-1 text-sm">
        {t('billing:adHocCharge.description.label')}
        <input
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('billing:adHocCharge.amountCents.label')}
        <input
          type="number"
          required
          min={1}
          value={amountCents}
          onChange={(event) => setAmountCents(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('billing:adHocCharge.dueOn.label')}
        <input
          type="date"
          required
          value={dueOn}
          onChange={(event) => setDueOn(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <ErrorMessage error={mutation.error} />

      <button
        type="submit"
        disabled={mutation.isPending}
        className="self-start rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {t('common:actions.create')}
      </button>
    </form>
  )
}
