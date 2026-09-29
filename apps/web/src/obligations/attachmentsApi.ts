import { apiFetch } from '../api/client'
import { apiUpload } from '../api/upload'

export type Attachment = {
  id: string
  obligationId: string
  filename: string
  contentType: string
  sizeBytes: number
  /** ISO-8601. */
  uploadedAt: string
}

export function listAttachments(obligationId: string): Promise<Attachment[]> {
  return apiFetch<Attachment[]>(`/obligations/${obligationId}/attachments`)
}

export function uploadAttachment(obligationId: string, file: File): Promise<Attachment> {
  return apiUpload<Attachment>(`/obligations/${obligationId}/attachments`, file)
}

export function deleteAttachment(obligationId: string, id: string): Promise<void> {
  return apiFetch<void>(`/obligations/${obligationId}/attachments/${id}`, { method: 'DELETE' })
}

/**
 * A plain URL, not a fetch: the download is an `<a download>`, so the
 * browser streams it straight to disk and the bytes never enter the page's
 * memory — or, more to the point, the service worker's cache (see the
 * NetworkOnly rule in vite.config.ts).
 */
export function attachmentDownloadUrl(obligationId: string, id: string): string {
  return `/api/v1/obligations/${obligationId}/attachments/${id}`
}
