import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PERIODICITY_VALUES } from '@ledger-hq/domain'
import type { Periodicity } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Dialog, Input, Select } from '../ui'
import { createAdHocObligation } from './api'

type Props = { clientId: string; onCreated: () => void }

/** Renders inside `Dialog.Content`. A fresh form each time the dialog opens. */
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
    onSuccess: onCreated,
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input required label={t('obligations:adHoc.code.label')} value={code} onChange={(event) => setCode(event.target.value)} />
        <Input required label={t('obligations:adHoc.name.label')} value={name} onChange={(event) => setName(event.target.value)} />
        <Select
          label={t('obligations:adHoc.periodicity.label')}
          value={periodicity}
          onChange={(event) => setPeriodicity(event.target.value as Periodicity)}
        >
          {PERIODICITY_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`domain:periodicity.${value}`)}
            </option>
          ))}
        </Select>
        <Input
          required
          label={t('obligations:adHoc.periodLabel.label')}
          value={periodLabel}
          onChange={(event) => setPeriodLabel(event.target.value)}
        />
        <Input
          type="date"
          required
          label={t('obligations:adHoc.dueDate.label')}
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />
      </div>

      <ErrorMessage error={mutation.error} />

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="primary" type="submit" isLoading={mutation.isPending}>
          {t('common:actions.create')}
        </Button>
      </Dialog.Footer>
    </form>
  )
}
