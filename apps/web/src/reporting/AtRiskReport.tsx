import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Card, DataList, EmptyState, Money } from '../ui'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { getAtRisk } from './api'
import { downloadCsv, formatCsvAmount, toCsv } from './toCsv'
import { ReportingPageSkeleton } from './ReportingPageSkeleton'

export function AtRiskReport() {
  const { t, i18n } = useTranslation('reporting')
  const locale = i18n.language as SupportedLocale

  const atRisk = useQuery({ queryKey: ['at-risk'], queryFn: () => getAtRisk() })

  function download() {
    if (atRisk.data === undefined) return

    const headers = [
      t('atRisk.column.client'),
      t('atRisk.column.overdueObligations'),
      t('atRisk.column.oldestDueDate'),
      t('atRisk.column.gross'),
      t('atRisk.column.credit'),
      t('atRisk.column.outstanding'),
    ]
    const rows = atRisk.data.map((row) => [
      row.clientName,
      String(row.overdueObligations),
      formatDate(row.oldestDueDate, locale),
      formatCsvAmount(row.grossOutstandingCents, locale),
      formatCsvAmount(row.creditCents, locale),
      formatCsvAmount(row.outstandingCents, locale),
    ])

    // ISO in the filename deliberately: a filename is sorted, not read aloud.
    downloadCsv(`at-risk-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, rows, locale))
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          {/* ReportingPage owns the h1; each report is a section of it. */}
          <h2 className="text-lg font-semibold">{t('atRisk.title')}</h2>
          <p className="text-sm text-muted">{t('atRisk.hint')}</p>
        </div>
        {atRisk.data !== undefined && atRisk.data.length > 0 && (
          <Button variant="secondary" onClick={download}>
            {t('download')}
          </Button>
        )}
      </header>

      {atRisk.isPending ? (
        <ReportingPageSkeleton />
      ) : atRisk.isError ? (
        <ErrorMessage error={atRisk.error} />
      ) : atRisk.data.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t('atRisk.empty')} description={t('atRisk.emptyHint')} />
      ) : (
        <Card padding="none" className="px-5">
          <DataList>
            {atRisk.data.map((row) => (
              <DataList.Row
                key={row.clientId}
                label={
                  <Link to="/clients/$clientId" params={{ clientId: row.clientId }} className="font-medium">
                    {row.clientName}
                  </Link>
                }
                value={
                  <>
                    <span className="text-sm text-muted">
                      {/* The count is its own element so it stays addressable by
                          text even though it sits beside the date in one span. */}
                      <span>{row.overdueObligations}</span> · {formatDate(row.oldestDueDate, locale)}
                    </span>
                    {row.creditCents > 0 && (
                      <span className="text-xs text-muted">
                        {t('atRisk.column.credit')} <Money cents={row.creditCents} size="sm" tone="credit" />
                      </span>
                    )}
                    <Money cents={row.outstandingCents} />
                  </>
                }
              />
            ))}
          </DataList>
        </Card>
      )}
    </section>
  )
}
