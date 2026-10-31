import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Receipt } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Badge, Button, Card, DataList, Dialog, EmptyState, Money } from '../ui'
import { getClientLedger } from './api'
import type { LedgerEntry } from './api'
import { AddAdHocChargeForm } from './AddAdHocChargeForm'
import { AgeingCard } from './AgeingCard'
import { ClientLedgerSkeleton } from './ClientLedgerSkeleton'
import { CreditCard } from './CreditCard'
import { RecordPaymentForm } from './RecordPaymentForm'
import { RetainerPlanCard } from './RetainerPlanCard'
import { WriteOffDialog } from './WriteOffDialog'

/**
 * The Billing tab: the ledger, and beside it (below it on a phone) the plan,
 * ageing and credit cards. Each card is its own file; this composes them and
 * owns the ledger's three dialogs.
 */
export function ClientLedgerSection({ clientId }: { clientId: string }) {
  const { t, i18n } = useTranslation(['billing', 'common'])
  const locale = i18n.language as SupportedLocale
  const queryClient = useQueryClient()
  const titleId = useId()
  const [recording, setRecording] = useState(false)
  const [charging, setCharging] = useState(false)
  const [writingOff, setWritingOff] = useState<LedgerEntry | null>(null)

  const ledger = useQuery({ queryKey: ['client-ledger', clientId], queryFn: () => getClientLedger(clientId) })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['client-ledger', clientId] })
    // SummaryRow and ReceivablesSection both read this key; spending credit
    // changes what they show.
    void queryClient.invalidateQueries({ queryKey: ['receivables'] })
  }

  return (
    <section aria-labelledby={titleId} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="flex min-w-0 flex-col gap-4 self-start">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id={titleId} className="text-base font-semibold">
            {t('billing:ledger.title')}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCharging(true)}>
              {t('billing:adHocCharge.newTitle')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setRecording(true)}>
              {t('billing:payment.recordTitle')}
            </Button>
          </div>
        </div>

        {ledger.isPending ? (
          <ClientLedgerSkeleton />
        ) : ledger.isError ? (
          <ErrorMessage error={ledger.error} />
        ) : ledger.data.entries.length === 0 ? (
          <EmptyState icon={Receipt} title={t('billing:ledger.empty')} description={t('billing:ledger.emptyHint')} />
        ) : (
          <DataList>
            {ledger.data.entries.map((entry, index) => (
              <DataList.Row
                key={index}
                wrapLabel
                label={
                  <span className="flex min-w-0 flex-col md:flex-row md:items-baseline md:gap-4">
                    <span className="text-xs text-muted tabular-nums md:w-24 md:shrink-0">{formatDate(entry.date, locale)}</span>
                    <span className="break-words">{entry.description}</span>
                  </span>
                }
                value={
                  <>
                    {/* The ledger carries no paid state (spec §2.5): only written-off is badged. */}
                    {entry.writtenOff && (
                      <Badge tone="neutral" strikethrough>
                        {t('billing:writeOff.badge')}
                      </Badge>
                    )}
                    {entry.type === 'CHARGE' && entry.chargeId !== null && !entry.writtenOff && (
                      <Button variant="danger" size="sm" onClick={() => setWritingOff(entry)}>
                        {t('billing:writeOff.action')}
                      </Button>
                    )}
                    <Money cents={entry.amountCents} tone={entry.writtenOff ? 'writtenOff' : 'auto'} />
                  </>
                }
              />
            ))}
            <DataList.Total label={t('billing:ledger.balance')} value={<Money cents={ledger.data.balanceCents} />} />
          </DataList>
        )}
      </Card>

      <div className="flex flex-col gap-6">
        <RetainerPlanCard clientId={clientId} onSaved={invalidate} />
        <AgeingCard clientId={clientId} />
        {ledger.data !== undefined && (
          <CreditCard clientId={clientId} availableCreditCents={ledger.data.availableCreditCents} onApplied={invalidate} />
        )}
      </div>

      <Dialog open={recording} onOpenChange={setRecording}>
        <Dialog.Content title={t('billing:payment.recordTitle')}>
          <RecordPaymentForm
            clientId={clientId}
            onRecorded={() => {
              setRecording(false)
              invalidate()
            }}
          />
        </Dialog.Content>
      </Dialog>

      <Dialog open={charging} onOpenChange={setCharging}>
        <Dialog.Content title={t('billing:adHocCharge.newTitle')}>
          <AddAdHocChargeForm
            clientId={clientId}
            onCreated={() => {
              setCharging(false)
              invalidate()
            }}
          />
        </Dialog.Content>
      </Dialog>

      <WriteOffDialog
        entry={writingOff}
        onClose={() => setWritingOff(null)}
        onWrittenOff={() => {
          setWritingOff(null)
          invalidate()
        }}
      />
    </section>
  )
}
