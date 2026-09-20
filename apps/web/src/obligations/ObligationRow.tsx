import { useTranslation } from 'react-i18next'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import type { ObligationResponse } from './api'

type Props = {
  obligation: ObligationResponse
  showClient: boolean
  onMarkDone: () => void
  /** Omitted on the global dashboard (mark-done only, per design doc 3.4); provided by the per-client section, which hosts the full manual-adjustment controls. */
  onEdit?: () => void
}

export function ObligationRow({ obligation, showClient, onMarkDone, onEdit }: Props) {
  const { t, i18n } = useTranslation('obligations')
  const isActionable = obligation.status === 'PENDING' || obligation.status === 'IN_PROGRESS'

  return (
    <li className="flex items-center justify-between gap-3 rounded border border-slate-200 bg-white p-3 text-sm">
      <span className="font-medium">
        {showClient ? `${obligation.clientName} — ` : ''}
        {obligation.definitionName}
      </span>
      <span className="text-slate-500">{formatDate(obligation.dueDate, i18n.language as SupportedLocale)}</span>

      {isActionable && (
        <div className="flex gap-2">
          {onEdit && (
            <button type="button" onClick={onEdit} className="text-xs underline">
              {t('row.edit')}
            </button>
          )}
          <button
            type="button"
            onClick={onMarkDone}
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          >
            {t('row.markDone')}
          </button>
        </div>
      )}
    </li>
  )
}
