import { useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Loader2, Paperclip } from 'lucide-react'
import { ACCEPTED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Button, DataList, Skeleton } from '../ui'
import type { ObligationResponse } from './api'
import { attachmentDownloadUrl, deleteAttachment, listAttachments, uploadAttachment } from './attachmentsApi'

type Props = { obligation: ObligationResponse }

/** Kilobytes are the right unit here: every accepted file is under 10 MiB. */
function formatSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} kB`
}

/** Renders inside the receipts dialog, which owns the title and the close. */
export function ObligationAttachments({ obligation }: Props) {
  const { t, i18n } = useTranslation(['obligations', 'common', 'errors'])
  const locale = i18n.language as SupportedLocale
  const queryClient = useQueryClient()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [tooLarge, setTooLarge] = useState(false)
  // The one irreversible action here, with no undo behind it: Delete asks
  // again in place rather than through window.confirm or a second dialog.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  // The Delete button unmounts when the question appears and Cancel unmounts
  // when it is taken back, so focus is moved by hand after each swap.
  const rootRef = useRef<HTMLDivElement>(null)
  const [pendingFocus, setPendingFocus] = useState<string | null>(null)

  useEffect(() => {
    if (pendingFocus === null) return
    rootRef.current?.querySelector<HTMLElement>(`[data-focus-id="${pendingFocus}"]`)?.focus()
    setPendingFocus(null)
  }, [pendingFocus])

  const askToDelete = (id: string) => {
    remove.reset()
    setConfirmingId(id)
    setPendingFocus(`cancel-${id}`)
  }
  const cancelDelete = (id: string) => {
    remove.reset()
    setConfirmingId(null)
    setPendingFocus(`delete-${id}`)
  }

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
    onSuccess: () => {
      setConfirmingId(null)
      // The row is gone; the upload control is the next thing to do here.
      inputRef.current?.focus()
      void invalidate()
    },
  })

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      <ErrorMessage error={attachments.error} />
      <ErrorMessage error={upload.error} />
      <ErrorMessage error={remove.error} />
      {tooLarge && <p className="text-sm text-danger-700">{t('errors:attachments.too_large')}</p>}

      {attachments.isPending ? (
        <Skeleton height="2.75rem" />
      ) : (attachments.data?.length ?? 0) === 0 ? (
        // An EmptyState inside a dialog is too heavy (spec §7.2).
        <p className="text-sm text-muted">{t('obligations:attachments.empty')}</p>
      ) : (
        <DataList>
          {attachments.data?.map((file) => (
            <DataList.Row
              key={file.id}
              label={
                <a
                  href={attachmentDownloadUrl(obligation.id, file.id)}
                  download={file.filename}
                  aria-label={t('obligations:attachments.download', { filename: file.filename })}
                  className="font-medium text-accent-700 hover:underline"
                >
                  {file.filename}
                </a>
              }
              value={
                confirmingId === file.id ? (
                  <>
                    <Button
                      key="confirm"
                      variant="danger"
                      size="sm"
                      aria-label={t('obligations:attachments.confirmDeleteNamed', { filename: file.filename })}
                      isLoading={remove.isPending}
                      onClick={() => remove.mutate(file.id)}
                    >
                      {t('obligations:attachments.confirmDeleteAction')}
                    </Button>
                    <Button
                      key="cancel"
                      variant="ghost"
                      size="sm"
                      data-focus-id={`cancel-${file.id}`}
                      onClick={() => cancelDelete(file.id)}
                    >
                      {t('common:actions.cancel')}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-muted tabular-nums">
                      {formatSize(file.sizeBytes)} · {formatDate(file.uploadedAt.slice(0, 10), locale)}
                    </span>
                    <Button
                      key="delete"
                      variant="ghost"
                      size="sm"
                      data-focus-id={`delete-${file.id}`}
                      aria-label={t('obligations:attachments.delete', { filename: file.filename })}
                      onClick={() => askToDelete(file.id)}
                    >
                      {t('common:actions.delete')}
                    </Button>
                  </>
                )
              }
            />
          ))}
        </DataList>
      )}

      <div className="flex flex-col gap-1.5">
        {/* A label dressed as a secondary button, with the file input inside
            it and visually hidden: the whole button opens the picker, and the
            input keeps its accessible name and its keyboard focus. */}
        <Button
          asChild
          variant="secondary"
          size="sm"
          className="cursor-pointer self-start has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-600 has-[:focus-visible]:ring-offset-2 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-60"
        >
          <label htmlFor={inputId}>
            <input
              id={inputId}
              ref={inputRef}
              type="file"
              accept={ACCEPTED_ATTACHMENT_TYPES.join(',')}
              disabled={upload.isPending}
              className="sr-only"
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
            />
            {upload.isPending ? (
              <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Paperclip aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            {t('obligations:attachments.add')}
          </label>
        </Button>
        <p className="text-xs text-muted">{t('obligations:attachments.hint')}</p>
        {upload.isPending && <p className="text-xs text-muted">{t('obligations:attachments.uploading')}</p>}
      </div>
    </div>
  )
}
