import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PERIODICITY_VALUES } from '@ledger-hq/domain'
import type { Periodicity } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { createAdHocObligation } from './api'

type Props = { clientId: string; onCreated: () => void }

export function AddAdHocObligationForm({ clientId, onCreated }: Props) {
  const { t } = useTranslation(['obligations', 'domain', 'common'])
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [periodicity, setPeriodicity] = useState<Periodicity>('ONE_OFF')
  const [periodLabel, setPeriodLabel] = useState('')
  const [dueDate, setDueDate] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      createAdHocObligation({
        clientId,
        code,
        name,
        periodicity,
        periodStart: dueDate,
        periodEnd: dueDate,
        periodLabel,
        dueDate,
      }),
    onSuccess: () => {
      setCode('')
      setName('')
      setPeriodLabel('')
      setDueDate('')
      onCreated()
    },
  })

  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <h3 className="font-medium">{t('obligations:adHoc.newTitle')}</h3>

      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:adHoc.code.label')}
        <input required value={code} onChange={(event) => setCode(event.target.value)} className="rounded border border-slate-300 px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:adHoc.name.label')}
        <input required value={name} onChange={(event) => setName(event.target.value)} className="rounded border border-slate-300 px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:adHoc.periodicity.label')}
        <select
          value={periodicity}
          onChange={(event) => setPeriodicity(event.target.value as Periodicity)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          {PERIODICITY_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`domain:periodicity.${value}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:adHoc.periodLabel.label')}
        <input
          required
          value={periodLabel}
          onChange={(event) => setPeriodLabel(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:adHoc.dueDate.label')}
        <input
          type="date"
          required
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
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
