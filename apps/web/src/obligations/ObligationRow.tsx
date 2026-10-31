import { useTranslation } from 'react-i18next'
import { Paperclip, PencilLine } from 'lucide-react'
import type { ObligationStatus } from '@ledger-hq/domain'
import { formatDate, formatQuarter } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Badge, Button } from '../ui'
import type { ObligationResponse } from './api'
import { STATUS_TONE } from './statusTone'

type Props = {
  obligation: ObligationResponse
  showClient: boolean
  onMarkDone: () => void
  /** Omitted on the global dashboard (mark-done only, per design doc 3.4); provided by the per-client section, which hosts the full manual-adjustment controls. */
  onEdit?: () => void
  /** Omitted on the global dashboard, which is mark-done only (design doc §3.4); supplied by the per-client section. */
  onManageAttachments?: () => void
}

/** Today as a UTC calendar date — the same day boundary `groupByUrgency` uses. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Draws its own bordered surface, so its lists are plain `<ul>`s, not cards. */
export function ObligationRow({ obligation, showClient, onMarkDone, onEdit, onManageAttachments }: Props) {
  const { t, i18n } = useTranslation(['obligations', 'domain'])
  const locale = i18n.language as SupportedLocale
  const status = obligation.status as ObligationStatus
  const isActionable = status === 'PENDING' || status === 'IN_PROGRESS'
  const isOverdue = isActionable && obligation.dueDate < todayIso()
  const dueClass = ['flex items-center gap-1 text-sm tabular-nums', isOverdue && 'text-danger-700']
    .filter(Boolean)
    .join(' ')

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-surface border border-line bg-surface px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">
          {showClient ? `${obligation.clientName} — ` : ''}
          {obligation.definitionName}
        </span>
        <span className="text-xs text-muted">{formatQuarter(obligation.periodLabel, locale)}</span>
      </div>

      <span className={dueClass}>
        <span>{formatDate(obligation.dueDate, locale)}</span>
        {obligation.dueDateOverridden && (
          <>
            <PencilLine aria-hidden="true" className="h-3.5 w-3.5 text-subtle" />
            <span className="sr-only">{t('obligations:row.overridden')}</span>
          </>
        )}
      </span>

      {status !== 'PENDING' && <Badge tone={STATUS_TONE[status]}>{t(`domain:obligationStatus.${status}`)}</Badge>}

      <div className="flex items-center gap-2">
        {isActionable && (
          <Button variant="secondary" size="sm" onClick={onMarkDone}>
            {t('obligations:row.markDone')}
          </Button>
        )}
        {/* As today: a done or waived obligation is not adjusted from its row. */}
        {isActionable && onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            {t('obligations:row.edit')}
          </Button>
        )}
        {onManageAttachments && (
          <Button variant="ghost" size="sm" onClick={onManageAttachments}>
            <Paperclip aria-hidden="true" className="h-3.5 w-3.5" />
            {t('obligations:attachments.manage')}
          </Button>
        )}
      </div>
    </li>
  )
}
