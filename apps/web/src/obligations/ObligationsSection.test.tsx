import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { initI18n } from '../i18n'

const listObligationsMock = vi.hoisted(() => vi.fn())
const generateObligationsMock = vi.hoisted(() => vi.fn())
const patchObligationMock = vi.hoisted(() => vi.fn())
const createAdHocObligationMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({
  listObligations: listObligationsMock,
  generateObligations: generateObligationsMock,
  patchObligation: patchObligationMock,
  createAdHocObligation: createAdHocObligationMock,
}))
vi.mock('./attachmentsApi', () => ({
  listAttachments: vi.fn().mockResolvedValue([]),
  uploadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  attachmentDownloadUrl: () => '#',
}))

const { ObligationsSection } = await import('./ObligationsSection')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ObligationsSection clientId="c1" />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

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
  status: 'PENDING',
  completedAt: null,
  reference: null,
  amountCents: null,
  notes: null,
}

describe('ObligationsSection', () => {
  beforeEach(() => {
    listObligationsMock.mockReset()
    generateObligationsMock.mockReset().mockResolvedValue({ toCreate: [], toRetract: [] })
    patchObligationMock.mockReset()
    createAdHocObligationMock.mockReset()
  })

  it('shows the empty state, with the hint, when there are no obligations', async () => {
    listObligationsMock.mockResolvedValue([])
    renderSection()
    expect(await screen.findByText(/ainda não há obrigações/i)).toBeInTheDocument()
    expect(screen.getByText(/preenche o perfil fiscal/i)).toBeInTheDocument()
  })

  it('shows a skeleton while the obligations load', async () => {
    listObligationsMock.mockReturnValue(new Promise(() => {}))
    const { container } = renderSection()
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull())
  })

  it('lists an obligation without the client name (showClient=false)', async () => {
    listObligationsMock.mockResolvedValue([obligation])
    renderSection()
    expect(await screen.findByText(/declaração periódica de iva/i)).toBeInTheDocument()
    expect(screen.queryByText(/padaria central/i)).not.toBeInTheDocument()
  })

  it('shows the generator preview as a callout with an Apply action', async () => {
    listObligationsMock.mockResolvedValue([])
    generateObligationsMock.mockResolvedValue({
      toCreate: [{ clientId: 'c1', definitionCode: 'VAT_MONTHLY_RETURN', periodLabel: '2026-02', dueDate: '2026-04-20' }],
      toRetract: [],
    })
    renderSection()

    expect(await screen.findByText('1 a criar, 0 a retirar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /aplicar/i })).toBeInTheDocument()
  })

  it('clicking Apply calls generateObligations with dryRun=false', async () => {
    listObligationsMock.mockResolvedValue([])
    generateObligationsMock.mockResolvedValueOnce({
      toCreate: [{ clientId: 'c1', definitionCode: 'VAT_MONTHLY_RETURN', periodLabel: '2026-02', dueDate: '2026-04-20' }],
      toRetract: [],
    })
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /aplicar/i }))

    expect(generateObligationsMock).toHaveBeenLastCalledWith({ clientId: 'c1' }, false)
  })

  it('adjusts an obligation in a dialog titled with its name and period, and closes it on save', async () => {
    listObligationsMock.mockResolvedValue([obligation])
    patchObligationMock.mockResolvedValue({ ...obligation, dueDate: '2026-04-01' })
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^editar$/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Declaração periódica de IVA — 2026-01' })
    const dueDate = within(dialog).getByLabelText(/prazo/i)
    await userEvent.clear(dueDate)
    await userEvent.type(dueDate, '2026-04-01')
    await userEvent.click(within(dialog).getByRole('button', { name: /^guardar$/i }))

    expect(patchObligationMock).toHaveBeenCalledWith('o1', expect.objectContaining({ dueDate: '2026-04-01' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // Spec §7.2: "waived needs a reason" is the notes field's own error now.
  it('blocks saving WAIVED with no notes, with the notes field in error', async () => {
    listObligationsMock.mockResolvedValue([obligation])
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^editar$/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText(/estado/i), 'WAIVED')

    const notes = within(dialog).getByLabelText(/notas/i)
    expect(notes).toHaveAttribute('aria-invalid', 'true')
    expect(notes).toHaveAccessibleDescription(/indica o motivo/i)
    expect(within(dialog).getByRole('button', { name: /^guardar$/i })).toBeDisabled()
    expect(patchObligationMock).not.toHaveBeenCalled()
  })

  it('creates an ad-hoc obligation from the New obligation dialog', async () => {
    listObligationsMock.mockResolvedValue([])
    createAdHocObligationMock.mockResolvedValue({ ...obligation, id: 'o2', definitionCode: 'BACKUP_RESTORE_DRILL' })
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /nova obrigação personalizada/i }))
    const dialog = await screen.findByRole('dialog', { name: /nova obrigação personalizada/i })
    await userEvent.type(within(dialog).getByLabelText(/código/i), 'BACKUP_RESTORE_DRILL')
    await userEvent.type(within(dialog).getByLabelText(/designação/i), 'Backup restore drill')
    await userEvent.type(within(dialog).getByLabelText(/período/i), '2026')
    await userEvent.type(within(dialog).getByLabelText(/prazo/i), '2026-06-30')
    await userEvent.click(within(dialog).getByRole('button', { name: /^criar$/i }))

    await vi.waitFor(() =>
      expect(createAdHocObligationMock).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'c1', code: 'BACKUP_RESTORE_DRILL', name: 'Backup restore drill' }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // Review Focus 5, for this tab's creation dialog.
  it('keeps the New obligation dialog open, with what was typed, when creating fails', async () => {
    listObligationsMock.mockResolvedValue([])
    createAdHocObligationMock.mockRejectedValue(new ApiError('common.internal_error', {}, 500))
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /nova obrigação personalizada/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/código/i), 'X')
    await userEvent.type(within(dialog).getByLabelText(/designação/i), 'Y')
    await userEvent.type(within(dialog).getByLabelText(/período/i), '2026')
    await userEvent.type(within(dialog).getByLabelText(/prazo/i), '2026-06-30')
    await userEvent.click(within(dialog).getByRole('button', { name: /^criar$/i }))

    expect(await within(dialog).findByText(/ocorreu um erro no servidor/i)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/código/i)).toHaveValue('X')
  })

  describe('receipts', () => {
    it('opens a dialog for the row whose receipts button was pressed', async () => {
      listObligationsMock.mockResolvedValue([{ ...obligation, status: 'DONE' }])
      renderSection()

      await userEvent.click(await screen.findByRole('button', { name: /^comprovativos$/i }))

      expect(await screen.findByRole('dialog', { name: /comprovativos — declaração periódica de iva/i })).toBeVisible()
    })

    // Design §3.7: requiring DONE would force the operator to mark an
    // obligation done before filing the proof that it is done. The UI leads
    // with the affordance on a DONE row because that is when a receipt
    // exists; nothing rejects an earlier upload.
    it('offers receipts on a PENDING obligation too', async () => {
      listObligationsMock.mockResolvedValue([obligation])
      renderSection()

      expect(await screen.findByRole('button', { name: /^comprovativos$/i })).toBeVisible()
    })
  })
})
