import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Money } from '../ui'
import { formatCurrency, formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { applyCredit } from './api'
import type { ApplyCreditResult } from './api'

type Props = { clientId: string; availableCreditCents: number; onApplied: () => void }

/**
 * Spends credit the client already paid. Renders nothing at all when there
 * is none: an action that can only ever propose an empty list is worse than
 * no action.
 */
export function ApplyCreditForm({ clientId, availableCreditCents, onApplied }: Props) {
  const { t, i18n } = useTranslation(['billing', 'common'])
  const titleId = useId()
  const [proposal, setProposal] = useState<ApplyCreditResult | null>(null)

  const propose = useMutation({
    mutationFn: () => applyCredit(clientId, true),
    onSuccess: (result) => setProposal(result),
  })

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
        (proposal?.proposed ?? [])
          .filter((row): row is typeof row & { paymentId: string } => row.paymentId !== null)
          .map((row) => ({ paymentId: row.paymentId, chargeId: row.chargeId, amountCents: row.amountCents })),
      ),
    onSuccess: () => {
      setProposal(null)
      onApplied()
    },
  })

  if (availableCreditCents <= 0) return null

  return (
    <section aria-labelledby={titleId} className="flex max-w-sm flex-col gap-3">
      <h3 id={titleId} className="font-medium">
        {t('billing:credit.title')}
      </h3>

      <p className="flex items-center justify-between text-sm">
        <span className="text-muted">{t('billing:credit.hint')}</span>
        <Money cents={availableCreditCents} tone="credit" />
      </p>

      <ErrorMessage error={propose.error} />

      {proposal === null ? (
        <button
          type="button"
          onClick={() => propose.mutate()}
          disabled={propose.isPending}
          className="self-start rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {t('billing:credit.propose')}
        </button>
      ) : proposal.proposed.length === 0 ? (
        <p className="text-sm text-muted">{t('billing:credit.nothingToApply')}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1 rounded border border-slate-200 p-2 text-sm">
            {proposal.proposed.map((allocation) => (
              <li key={`${allocation.paymentId}:${allocation.chargeId}`} className="flex items-center justify-between">
                <span>
                  {allocation.description}
                  {allocation.dueOn !== null && (
                    <span className="text-slate-500"> · {formatDate(allocation.dueOn, i18n.language as SupportedLocale)}</span>
                  )}
                </span>
                <span>{formatCurrency(allocation.amountCents, i18n.language as SupportedLocale)}</span>
              </li>
            ))}
          </ul>
          {proposal.remainingCreditCents > 0 && (
            <p className="text-xs text-slate-600">
              {t('billing:credit.remaining', { amount: formatCurrency(proposal.remainingCreditCents, i18n.language as SupportedLocale) })}
            </p>
          )}
          <ErrorMessage error={confirm.error} />
          <button
            type="button"
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending}
            className="self-start rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {t('billing:credit.confirm')}
          </button>
        </>
      )}
    </section>
  )
}
