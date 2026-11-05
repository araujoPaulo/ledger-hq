import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Dialog, Money, Textarea } from '../ui'
import { writeOffCharge } from './api'
import type { LedgerEntry } from './api'

type Props = { entry: LedgerEntry | null; onClose: () => void; onWrittenOff: () => void }

/** Holds the charge being written off; `null` is closed. */
export function WriteOffDialog({ entry, onClose, onWrittenOff }: Props) {
  const { t } = useTranslation('billing')

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {entry !== null && entry.chargeId !== null && (
        <Dialog.Content title={t('writeOff.title')} size="sm">
          <WriteOffForm entry={entry} chargeId={entry.chargeId} onWrittenOff={onWrittenOff} />
        </Dialog.Content>
      )}
    </Dialog>
  )
}

/** Its own component so the reason starts empty every time the dialog opens. */
function WriteOffForm({ entry, chargeId, onWrittenOff }: { entry: LedgerEntry; chargeId: string; onWrittenOff: () => void }) {
  const { t } = useTranslation(['billing', 'common'])
  const [reason, setReason] = useState('')
  const hasReason = reason.trim() !== ''

  const mutation = useMutation({
    mutationFn: () => writeOffCharge(chargeId, reason),
    onSuccess: onWrittenOff,
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!hasReason) return
        mutation.mutate()
      }}
    >
      <p className="flex items-center justify-between gap-4 text-sm">
        <span className="min-w-0 truncate">{entry.description}</span>
        <Money cents={entry.amountCents} />
      </p>
      <Textarea
        required
        label={t('billing:writeOff.reason.label')}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <ErrorMessage error={mutation.error} />
      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="danger" type="submit" isLoading={mutation.isPending} disabled={!hasReason}>
          {t('billing:writeOff.action')}
        </Button>
      </Dialog.Footer>
    </form>
  )
}
