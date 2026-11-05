import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, DataList, Dialog, Money } from '../ui'
import { formatCurrency, formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { applyCredit } from './api'
import type { ApplyCreditResult } from './api'

type Props = { clientId: string; proposal: ApplyCreditResult; onApplied: () => void }

/** Renders inside the credit dialog: the proposal the card asked for, then Confirm. */
export function ApplyCreditForm({ clientId, proposal, onApplied }: Props) {
  const { t, i18n } = useTranslation(['billing', 'common'])
  const locale = i18n.language as SupportedLocale

  const confirm = useMutation({
    mutationFn: () =>
      applyCredit(
        clientId,
        false,
        // Only the allocation itself goes back on the wire; the description
        // and period the proposal carries are for the operator, and the
        // endpoint's schema is strict — `paymentId` is a `uuidSchema`, so a
        // null one (which this screen's proposals never actually carry,
        // since they all name a real credited payment) is dropped rather
        // than sent, to keep an unreachable case from ever reaching a raw
        // Zod 400.
        proposal.proposed
          .filter((row): row is typeof row & { paymentId: string } => row.paymentId !== null)
          .map((row) => ({ paymentId: row.paymentId, chargeId: row.chargeId, amountCents: row.amountCents })),
      ),
    onSuccess: onApplied,
  })

  if (proposal.proposed.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('billing:credit.nothingToApply')}</p>
        <Dialog.Footer>
          <Dialog.Close asChild>
            <Button variant="secondary">{t('common:actions.close')}</Button>
          </Dialog.Close>
        </Dialog.Footer>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <DataList>
        {proposal.proposed.map((allocation) => (
          <DataList.Row
            key={`${allocation.paymentId}:${allocation.chargeId}`}
            label={
              <span>
                {allocation.description}
                {allocation.dueOn !== null && <span className="text-muted"> · {formatDate(allocation.dueOn, locale)}</span>}
              </span>
            }
            value={<Money cents={allocation.amountCents} />}
          />
        ))}
      </DataList>
      {proposal.remainingCreditCents > 0 && (
        <p className="text-xs text-muted">
          {t('billing:credit.remaining', { amount: formatCurrency(proposal.remainingCreditCents, locale) })}
        </p>
      )}
      <ErrorMessage error={confirm.error} />
      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="primary" isLoading={confirm.isPending} onClick={() => confirm.mutate()}>
          {t('billing:credit.confirm')}
        </Button>
      </Dialog.Footer>
    </div>
  )
}
