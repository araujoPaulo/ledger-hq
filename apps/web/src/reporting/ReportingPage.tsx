import { useTranslation } from 'react-i18next'
import { PageHeader } from '../ui'
import { AtRiskReport } from './AtRiskReport'
import { PeriodSummaryReport } from './PeriodSummaryReport'

export function ReportingPage() {
  const { t } = useTranslation('reporting')

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('title')} />
      <AtRiskReport />
      <PeriodSummaryReport />
    </div>
  )
}
