import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const listObligationsMock = vi.hoisted(() => vi.fn())
const generateObligationsMock = vi.hoisted(() => vi.fn())
const patchObligationMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({
  listObligations: listObligationsMock,
  generateObligations: generateObligationsMock,
  patchObligation: patchObligationMock,
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
  })

  it('shows the empty state when there are no obligations and no preview diff', async () => {
    listObligationsMock.mockResolvedValue([])
    renderSection()
    expect(await screen.findByText(/ainda não há obrigações/i)).toBeInTheDocument()
  })

  it('lists an obligation without the client name (showClient=false)', async () => {
    listObligationsMock.mockResolvedValue([obligation])
    renderSection()
    expect(await screen.findByText(/declaração periódica de iva/i)).toBeInTheDocument()
    expect(screen.queryByText(/padaria central/i)).not.toBeInTheDocument()
  })

  it('shows a preview banner with an Apply button when the dry run proposes changes', async () => {
    listObligationsMock.mockResolvedValue([])
    generateObligationsMock.mockResolvedValue({
      toCreate: [{ clientId: 'c1', definitionCode: 'VAT_MONTHLY_RETURN', periodLabel: '2026-02', dueDate: '2026-04-20' }],
      toRetract: [],
    })
    renderSection()

    expect(await screen.findByRole('button', { name: /aplicar/i })).toBeInTheDocument()
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

  it('opening the edit form and submitting a due-date change calls patchObligation', async () => {
    listObligationsMock.mockResolvedValue([obligation])
    patchObligationMock.mockResolvedValue({ ...obligation, dueDate: '2026-04-01' })
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^editar$/i }))
    const dueDateInput = screen.getByLabelText(/prazo/i)
    await userEvent.clear(dueDateInput)
    await userEvent.type(dueDateInput, '2026-04-01')
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }))

    expect(patchObligationMock).toHaveBeenCalledWith('o1', expect.objectContaining({ dueDate: '2026-04-01' }))
  })

  it('blocks submitting WAIVED with no notes', async () => {
    listObligationsMock.mockResolvedValue([obligation])
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^editar$/i }))
    await userEvent.selectOptions(screen.getByLabelText(/estado/i), 'WAIVED')
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }))

    expect(patchObligationMock).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/indica o motivo/i)
  })
})
