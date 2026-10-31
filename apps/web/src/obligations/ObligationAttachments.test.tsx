import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ApiError } from '../api/client'

const listAttachmentsMock = vi.hoisted(() => vi.fn())
const uploadAttachmentMock = vi.hoisted(() => vi.fn())
const deleteAttachmentMock = vi.hoisted(() => vi.fn())
vi.mock('./attachmentsApi', () => ({
  listAttachments: listAttachmentsMock,
  uploadAttachment: uploadAttachmentMock,
  deleteAttachment: deleteAttachmentMock,
  attachmentDownloadUrl: (obligationId: string, id: string) => `/api/v1/obligations/${obligationId}/attachments/${id}`,
}))

const { ObligationAttachments } = await import('./ObligationAttachments')

await initI18n()
await i18next.changeLanguage('pt-PT')

const obligation = {
  id: 'o1',
  clientId: 'c1',
  clientName: 'Padaria Central, Lda.',
  definitionCode: 'VAT_MONTHLY_RETURN',
  definitionName: 'Declaração periódica de IVA',
  authority: 'TAX',
  periodLabel: '2026-01',
  dueDate: '2026-03-20',
  dueDateOverridden: false,
  status: 'DONE',
  completedAt: '2026-03-18T09:00:00.000Z',
  reference: null,
  amountCents: null,
  notes: null,
}

const attachment = {
  id: 'a1',
  obligationId: 'o1',
  filename: 'Declaração periódica.pdf',
  contentType: 'application/pdf',
  sizeBytes: 34567,
  uploadedAt: '2026-03-18T09:05:00.000Z',
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ObligationAttachments obligation={obligation} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listAttachmentsMock.mockReset().mockResolvedValue([])
  uploadAttachmentMock.mockReset()
  deleteAttachmentMock.mockReset()
  vi.restoreAllMocks()
})

describe('ObligationAttachments', () => {
  it('lists each attachment with a download link to the API route', async () => {
    listAttachmentsMock.mockResolvedValue([attachment])

    renderPanel()

    const link = await screen.findByRole('link', { name: /transferir declaração periódica\.pdf/i })
    expect(link).toHaveAttribute('href', '/api/v1/obligations/o1/attachments/a1')
    expect(link).toHaveAttribute('download')
  })

  // Most obligations will never have a receipt, so an EmptyState here would
  // be decoration on a non-event (docs/design/guidelines.md §2).
  it('shows a plain sentence and the affordance when there is nothing attached', async () => {
    renderPanel()

    expect(await screen.findByText(/ainda não há comprovativos/i)).toBeVisible()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByLabelText(/anexar ficheiro/i)).toBeVisible()
  })

  it('uploads the chosen file and refreshes the list', async () => {
    uploadAttachmentMock.mockResolvedValue(attachment)
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'recibo.pdf', { type: 'application/pdf' })

    renderPanel()

    await userEvent.upload(await screen.findByLabelText(/anexar ficheiro/i), file)

    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalledWith('o1', file))
    await waitFor(() => expect(listAttachmentsMock).toHaveBeenCalledTimes(2))
  })

  it('accepts only the three permitted types on the input', async () => {
    renderPanel()

    expect(await screen.findByLabelText(/anexar ficheiro/i)).toHaveAttribute(
      'accept',
      'application/pdf,image/png,image/jpeg',
    )
  })

  it('refuses an oversized file without calling the server', async () => {
    const tooBig = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.pdf', { type: 'application/pdf' })

    renderPanel()

    await userEvent.upload(await screen.findByLabelText(/anexar ficheiro/i), tooBig)

    expect(uploadAttachmentMock).not.toHaveBeenCalled()
    expect(await screen.findByText(/excede o limite/i)).toBeVisible()
  })

  // Spec §2.6: no window.confirm, and no dialog on top of a dialog — the
  // row's Delete becomes "Delete for good" plus Cancel, in place.
  it('asks again in place before deleting, and Cancel takes the question back', async () => {
    listAttachmentsMock.mockResolvedValue([attachment])
    const confirm = vi.spyOn(window, 'confirm')

    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /eliminar declaração periódica\.pdf/i }))
    expect(screen.getByRole('button', { name: /apagar definitivamente/i })).toBeInTheDocument()
    expect(deleteAttachmentMock).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^cancelar$/i }))
    expect(screen.queryByRole('button', { name: /apagar definitivamente/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /eliminar declaração periódica\.pdf/i })).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('deletes once the operator confirms in place', async () => {
    listAttachmentsMock.mockResolvedValue([attachment])
    deleteAttachmentMock.mockResolvedValue(undefined)

    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /eliminar declaração periódica\.pdf/i }))
    await userEvent.click(screen.getByRole('button', { name: /apagar definitivamente/i }))

    await waitFor(() => expect(deleteAttachmentMock).toHaveBeenCalledWith('o1', 'a1'))
  })

  it('shows the size and the upload date beside the file', async () => {
    listAttachmentsMock.mockResolvedValue([attachment])

    renderPanel()

    expect(await screen.findByText('34 kB · 18/03/2026')).toBeInTheDocument()
  })

  // Corrected from the brief: ErrorMessage gates on `error instanceof
  // ApiError`, and Object.assign(new Error(...), {...}) never satisfies
  // that — the prototype chain is unchanged. A real ApiError is required
  // for this rejection to render the server's message rather than
  // common.unexpected.
  it("shows the server's message when the file is gone", async () => {
    listAttachmentsMock.mockRejectedValue(new ApiError('attachments.file_missing', {}, 410))

    renderPanel()

    expect(await screen.findByText(/não está no servidor/i)).toBeVisible()
  })

  it("shows the server's message inside the panel when an upload fails", async () => {
    uploadAttachmentMock.mockRejectedValue(new ApiError('attachments.file_missing', {}, 410))
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'recibo.pdf', { type: 'application/pdf' })

    renderPanel()

    await userEvent.upload(await screen.findByLabelText(/anexar ficheiro/i), file)

    expect(await screen.findByText(/não está no servidor/i)).toBeVisible()
  })
})
