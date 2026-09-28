import { useTranslation } from 'react-i18next'
import { PageHeader } from './ui'
import { SummaryRow } from './home/SummaryRow'
import { ObligationsDashboard } from './obligations/ObligationsDashboard'
import { ReceivablesSection } from './billing/ReceivablesSection'
import { formatLongDate } from './i18n/format'
import type { SupportedLocale } from './i18n/format'

export function HomePage() {
  const { t, i18n } = useTranslation('common')
  // Costs no key, and tells the reader what "this week" is anchored to.
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('home.title')} description={formatLongDate(today, i18n.language as SupportedLocale)} />
      <SummaryRow />
      <ObligationsDashboard />
      <ReceivablesSection />
    </div>
  )
}
