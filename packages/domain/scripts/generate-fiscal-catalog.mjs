import { writeFileSync } from 'node:fs'
import { FISCAL_CATALOG } from '../dist/obligations/catalog/index.js'

function deadlineText(entry) {
  const { deadline } = entry
  if (deadline.kind === 'fixedDate') {
    return `${deadline.day}/${deadline.month}${deadline.yearsAfter > 0 ? ' (following year)' : ''}`
  }
  if (deadline.kind === 'lastDayOfMonthAfterPeriodEnd') {
    return `last day of the ${deadline.monthsAfter}-months-after month`
  }
  return `day ${deadline.day} of the ${deadline.monthsAfter}-months-after month`
}

function section(locale) {
  const rows = FISCAL_CATALOG.map(
    (entry) =>
      `| \`${entry.code}\` | ${entry.i18n[locale].name} | ${entry.i18n[locale].description} | ${entry.authority} | ${entry.periodicity} | ${deadlineText(entry)} | ${entry.legalRef} | ${entry.validFrom} | ${entry.validTo ?? '—'} |`,
  )

  return [
    `## ${locale === 'pt' ? 'Português' : 'English'}`,
    '',
    '| Code | Name | Description | Authority | Periodicity | Deadline | Legal reference | Valid from | Valid to |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

const content = [
  '# Fiscal obligation catalog',
  '',
  '**Generated from `packages/domain/src/obligations/catalog/`. Do not edit by hand — edit the catalog source and re-run `pnpm --filter @ledger-hq/domain generate:fiscal-catalog`.**',
  '',
  section('pt'),
  '',
  section('en'),
  '',
].join('\n')

writeFileSync(new URL('../../../docs/fiscal-catalog.md', import.meta.url), content)
console.log(`Wrote docs/fiscal-catalog.md with ${FISCAL_CATALOG.length} entries.`)
