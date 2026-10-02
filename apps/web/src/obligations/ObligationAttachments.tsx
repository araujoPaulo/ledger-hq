import { useId, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ACCEPTED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import type { ObligationResponse } from './api'
import { attachmentDownloadUrl, deleteAttachment, listAttachments, uploadAttachment } from './attachmentsApi'

type Props = { obligation: ObligationResponse; onClose: () => void }

/** Kilobytes are the right unit here: every accepted file is under 10 MiB. */
function formatSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} kB`
}

export function ObligationAttachments({ obligation, onClose }: Props) {
  const { t, i18n } = useTranslation(['obligations', 'common', 'errors'])
  const queryClient = useQueryClient()
  const titleId = useId()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [tooLarge, setTooLarge] = useState(false)

  const queryKey = ['obligation-attachments', obligation.id]
  const attachments = useQuery({ queryKey, queryFn: () => listAttachments(obligation.id) })

  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  const upload = useMutation({
    mutationFn: (file: File) => uploadAttachment(obligation.id, file),
    onSuccess: () => {
      // Clearing the input is what lets the same file be chosen twice in a
      // row: a change event never fires for an unchanged value.
      if (inputRef.current) inputRef.current.value = ''
      void invalidate()
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteAttachment(obligation.id, id),
    onSuccess: invalidate,
  })

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 rounded border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <h3 id={titleId} className="text-sm font-semibold">
          {t('obligations:attachments.title')} — {obligation.definitionName}
        </h3>
        <button type="button" onClick={onClose} className="text-xs underline">
          {t('obligations:attachments.close')}
        </button>
      </div>

      <ErrorMessage error={attachments.error} />
      <ErrorMessage error={upload.error} />
      <ErrorMessage error={remove.error} />
      {tooLarge && <p className="text-sm text-danger-700">{t('errors:attachments.too_large')}</p>}

      {attachments.isPending ? null : (attachments.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-slate-600">{t('obligations:attachments.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {attachments.data?.map((file) => (
            <li key={file.id} className="flex items-center justify-between gap-3 text-sm">
              <a
                href={attachmentDownloadUrl(obligation.id, file.id)}
                download={file.filename}
                aria-label={t('obligations:attachments.download', { filename: file.filename })}
                className="underline"
              >
                {file.filename}
              </a>
              <span className="text-slate-500">
                {formatSize(file.sizeBytes)} · {formatDate(file.uploadedAt.slice(0, 10), i18n.language as SupportedLocale)}
              </span>
              <button
                type="button"
                aria-label={t('obligations:attachments.delete', { filename: file.filename })}
                onClick={() => {
                  // The one irreversible action in this panel, and there is
                  // no undo behind it.
                  if (!window.confirm(t('obligations:attachments.confirmDelete', { filename: file.filename }))) return
                  remove.mutate(file.id)
                }}
                className="text-xs text-red-700 underline"
              >
                {t('common:actions.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <label htmlFor={inputId} className="text-sm font-medium">
        {t('obligations:attachments.add')}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={ACCEPTED_ATTACHMENT_TYPES.join(',')}
        disabled={upload.isPending}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          // Checked here as well as on the server: a 10 MiB upload that is
          // going to be rejected anyway should not be sent over a phone's
          // connection first.
          if (file.size > MAX_ATTACHMENT_BYTES) {
            setTooLarge(true)
            event.target.value = ''
            return
          }
          setTooLarge(false)
          upload.mutate(file)
        }}
        className="text-sm"
      />
      <p className="text-xs text-slate-500">{t('obligations:attachments.hint')}</p>
      {upload.isPending && <p className="text-xs text-slate-500">{t('obligations:attachments.uploading')}</p>}
    </section>
  )
}
