import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Dialog, Input, MoneyInput } from '../ui'
import { createAdHocCharge } from './api'

type Props = { clientId: string; onCreated: () => void }

/** Renders inside `Dialog.Content`. A fresh form each time the dialog opens. */
export function AddAdHocChargeForm({ clientId, onCreated }: Props) {
  const { t } = useTranslation(['billing', 'common'])
  const [description, setDescription] = useState('')
  const [amountCents, setAmountCents] = useState<number | null>(null)
  const [dueOn, setDueOn] = useState('')

  const mutation = useMutation({
    mutationFn: (cents: number) => createAdHocCharge({ clientId, description, amountCents: cents, dueOn }),
    onSuccess: onCreated,
  })

  const canSubmit = description.trim() !== '' && amountCents !== null && amountCents > 0 && dueOn !== ''

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit || amountCents === null) return
        mutation.mutate(amountCents)
      }}
    >
      <Input
        required
        label={t('billing:adHocCharge.description.label')}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <MoneyInput required label={t('billing:adHocCharge.amountCents.label')} onValueChange={setAmountCents} />
      <Input
        type="date"
        required
        label={t('billing:adHocCharge.dueOn.label')}
        value={dueOn}
        onChange={(event) => setDueOn(event.target.value)}
      />

      <ErrorMessage error={mutation.error} />

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="primary" type="submit" isLoading={mutation.isPending} disabled={!canSubmit}>
          {t('common:actions.create')}
        </Button>
      </Dialog.Footer>
    </form>
  )
}
