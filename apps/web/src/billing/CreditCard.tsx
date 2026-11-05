import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Card, Dialog, Money } from '../ui'
import { applyCredit } from './api'
import type { ApplyCreditResult } from './api'
import { ApplyCreditForm } from './ApplyCreditForm'

type Props = { clientId: string; availableCreditCents: number; onApplied: () => void }

/**
 * Spends credit the client already paid. Renders nothing at all when there is
 * none: an action that can only ever propose an empty list is worse than no
 * action. "Apply credit" asks the server for a proposal first and shows it in
 * a dialog; nothing is written until Confirm.
 */
export function CreditCard({ clientId, availableCreditCents, onApplied }: Props) {
  const { t } = useTranslation('billing')
  const titleId = useId()
  const [proposal, setProposal] = useState<ApplyCreditResult | null>(null)

  const propose = useMutation({
    mutationFn: () => applyCredit(clientId, true),
    onSuccess: (result) => setProposal(result),
  })

  if (availableCreditCents <= 0) return null

  return (
    <section aria-labelledby={titleId}>
      <Card className="flex flex-col gap-4">
        <h2 id={titleId} className="text-base font-semibold">
          {t('credit.title')}
        </h2>
        <Money cents={availableCreditCents} tone="credit" size="lg" />
        <p className="text-xs font-normal text-muted">{t('credit.hint')}</p>
        <ErrorMessage error={propose.error} />
        <Button variant="secondary" size="sm" className="self-start" isLoading={propose.isPending} onClick={() => propose.mutate()}>
          {t('credit.propose')}
        </Button>
      </Card>

      <Dialog open={proposal !== null} onOpenChange={(open) => (open ? undefined : setProposal(null))}>
        {proposal !== null && (
          <Dialog.Content title={t('credit.title')}>
            <ApplyCreditForm
              clientId={clientId}
              proposal={proposal}
              onApplied={() => {
                setProposal(null)
                onApplied()
              }}
            />
          </Dialog.Content>
        )}
      </Dialog>
    </section>
  )
}
