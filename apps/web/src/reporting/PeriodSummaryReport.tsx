import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Card, DataList, Money } from '../ui'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { getPeriodSummary } from './api'
import { downloadCsv, formatCsvAmount, toCsv } from './toCsv'
import { ReportingPageSkeleton } from './ReportingPageSkeleton'

/** Defaults to the current calendar year, the window most often asked for. */
function defaultWindow(): { from: string; to: string } {
  const year = new Date().getUTCFullYear()
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

export function PeriodSummaryReport() {
  const { t, i18n } = useTranslation('reporting')
  const locale = i18n.language as SupportedLocale
  const [window, setWindow] = useState(defaultWindow)

  // Guarding here (rather than only disabling the query below) keeps the
  // inputs themselves from offering a combination that cannot be asked for:
  // the "from" picker cannot go past the current "to", and vice versa.
  const isInverted = window.from > window.to

  const summary = useQuery({
    queryKey: ['period-summary', window.from, window.to],
    queryFn: () => getPeriodSummary(window.from, window.to),
    // The server rejects an inverted window with a 422; do not ask it.
    enabled: !isInverted,
  })

  function download() {
    if (summary.data === undefined) return

    const headers = [
      t('periodSummary.from'),
      t('periodSummary.to'),
      t('periodSummary.obligationsDue'),
      t('periodSummary.obligationsDone'),
      t('periodSummary.chargesIssued'),
      t('periodSummary.paymentsReceived'),
      t('periodSummary.outstandingAtClose'),
    ]
    const rows = [
      [
        formatDate(summary.data.from, locale),
        formatDate(summary.data.to, locale),
        String(summary.data.obligationsDue),
        String(summary.data.obligationsDone),
        formatCsvAmount(summary.data.chargesIssuedCents, locale),
        formatCsvAmount(summary.data.paymentsReceivedCents, locale),
        formatCsvAmount(summary.data.outstandingAtCloseCents, locale),
      ],
    ]

    downloadCsv(`period-summary-${window.from}_${window.to}.csv`, toCsv(headers, rows, locale))
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-lg font-semibold">{t('periodSummary.title')}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-subtle">
            {t('periodSummary.from')}
            <input
              type="date"
              value={window.from}
              max={window.to}
              onChange={(event) => setWindow((current) => ({ ...current, from: event.target.value }))}
              className="rounded-control border border-line bg-ground px-2 py-1 text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-subtle">
            {t('periodSummary.to')}
            <input
              type="date"
              value={window.to}
              min={window.from}
              onChange={(event) => setWindow((current) => ({ ...current, to: event.target.value }))}
              className="rounded-control border border-line bg-ground px-2 py-1 text-ink"
            />
          </label>
          {summary.data !== undefined && (
            <Button variant="secondary" onClick={download}>
              {t('download')}
            </Button>
          )}
        </div>
      </header>

      {isInverted ? (
        // Not an error (nothing failed) and not the loading skeleton (nothing
        // is coming): `enabled: false` would otherwise leave the query
        // parked in `pending` forever, so this branch has to come first or
        // the skeleton below would show indefinitely for a range that will
        // never be asked for.
        <p role="status" className="text-sm text-danger-700">
          {t('periodSummary.invalidRange')}
        </p>
      ) : summary.isPending ? (
        <ReportingPageSkeleton />
      ) : summary.isError ? (
        <ErrorMessage error={summary.error} />
      ) : (
        <Card padding="none" className="px-5">
          <DataList>
            <DataList.Row label={t('periodSummary.obligationsDue')} value={summary.data.obligationsDue} />
            <DataList.Row label={t('periodSummary.obligationsDone')} value={summary.data.obligationsDone} />
            <DataList.Row
              label={t('periodSummary.chargesIssued')}
              value={<Money cents={summary.data.chargesIssuedCents} />}
            />
            <DataList.Row
              label={t('periodSummary.paymentsReceived')}
              value={<Money cents={summary.data.paymentsReceivedCents} tone="credit" />}
            />
            <DataList.Total
              label={t('periodSummary.outstandingAtClose')}
              value={<Money cents={summary.data.outstandingAtCloseCents} />}
            />
          </DataList>
        </Card>
      )}
    </section>
  )
}
