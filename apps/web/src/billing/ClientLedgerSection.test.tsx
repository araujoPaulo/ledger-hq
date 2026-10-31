import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ApiError } from '../api/client'

const getClientLedgerMock = vi.hoisted(() => vi.fn())
const proposeAllocationMock = vi.hoisted(() => vi.fn())
const recordPaymentMock = vi.hoisted(() => vi.fn())
const writeOffChargeMock = vi.hoisted(() => vi.fn())
const getCurrentRetainerPlanMock = vi.hoisted(() => vi.fn())
const getReceivablesMock = vi.hoisted(() => vi.fn())
const createAdHocChargeMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({
  getClientLedger: getClientLedgerMock,
  proposeAllocation: proposeAllocationMock,
  recordPayment: recordPaymentMock,
  applyCredit: vi.fn(),
  writeOffCharge: writeOffChargeMock,
  getCurrentRetainerPlan: getCurrentRetainerPlanMock,
  createRetainerPlan: vi.fn(),
  renewRetainerPlan: vi.fn(),
  getReceivables: getReceivablesMock,
  createAdHocCharge: createAdHocChargeMock,
}))

const { ClientLedgerSection } = await import('./ClientLedgerSection')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ClientLedgerSection clientId="c1" />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

const EMPTY_LEDGER = { entries: [], balanceCents: 0, availableCreditCents: 0 }
const PROPOSAL = {
  proposed: [{ chargeId: 'charge-1', amountCents: 215000, description: 'Retainer — 2026-01', periodLabel: '2026-01', dueOn: '2026-01-08' }],
  excessCents: 0,
}

async function openPaymentDialog() {
  await userEvent.click(await screen.findByRole('button', { name: /registar pagamento/i }))
  return screen.findByRole('dialog', { name: /registar pagamento/i })
}

/** The payment form ignores Confirmar for a moment after the proposal appears. */
const afterConfirmGuard = () => new Promise((resolve) => setTimeout(resolve, 450))

beforeEach(() => {
  vi.clearAllMocks()
  getClientLedgerMock.mockResolvedValue(EMPTY_LEDGER)
  getCurrentRetainerPlanMock.mockResolvedValue(null)
  getReceivablesMock.mockResolvedValue([])
})

describe('ClientLedgerSection', () => {
  it('shows a skeleton while the ledger loads', async () => {
    getClientLedgerMock.mockReturnValue(new Promise(() => {}))
    const { container } = renderSection()
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull())
  })

  it('shows the empty state, with its hint, with no billing history', async () => {
    renderSection()
    expect(await screen.findByText(/sem movimentos de faturação/i)).toBeInTheDocument()
    expect(screen.getByText(/as avenças e cobranças aparecem aqui/i)).toBeInTheDocument()
  })

  it('lists entries with their dates, and the balance as the total', async () => {
    getClientLedgerMock.mockResolvedValue({
      entries: [
        { type: 'CHARGE', date: '2026-01-01', description: 'Retainer — 2026-01', amountCents: 9000, runningBalanceCents: 9000, chargeId: 'charge-1', writtenOff: false },
        { type: 'PAYMENT', date: '2026-01-10', description: 'Pagamento — TRANSFER', amountCents: -9000, runningBalanceCents: 0, chargeId: null, writtenOff: false },
      ],
      balanceCents: 0,
      availableCreditCents: 0,
    })
    renderSection()

    expect(await screen.findByText(/retainer — 2026-01/i)).toBeInTheDocument()
    expect(screen.getByText('01/01/2026')).toBeInTheDocument()
    expect(screen.getByText(/pagamento — transfer/i)).toBeInTheDocument()
    expect(screen.getByText('Saldo')).toBeInTheDocument()
  })

  // V5: a long description wraps at phone width instead of being ellipsised.
  it('lets a ledger description wrap', async () => {
    getClientLedgerMock.mockResolvedValue({
      entries: [{ type: 'CHARGE', date: '2026-01-01', description: 'Monthly retainer 2026-01 long description', amountCents: 9000, runningBalanceCents: 9000, chargeId: 'charge-1', writtenOff: false }],
      balanceCents: 9000,
      availableCreditCents: 0,
    })
    renderSection()

    const description = await screen.findByText(/monthly retainer 2026-01/i)
    expect(description.className).not.toContain('truncate')
    expect(description).toHaveClass('break-words')
    expect(description.closest('div')?.className).not.toContain('truncate')
  })

  // Spec §2.5: only "written off" gets a badge — the ledger carries no paid state.
  it('badges a written-off charge and offers no write-off on it', async () => {
    getClientLedgerMock.mockResolvedValue({
      entries: [
        { type: 'CHARGE', date: '2026-01-01', description: 'Incobrável', amountCents: 50000, runningBalanceCents: 50000, chargeId: 'charge-1', writtenOff: true },
        { type: 'WRITE_OFF', date: '2026-02-01', description: 'Insolvente', amountCents: -50000, runningBalanceCents: 0, chargeId: 'charge-1', writtenOff: true },
      ],
      balanceCents: 0,
      availableCreditCents: 0,
    })
    renderSection()

    expect(await screen.findByText(/incobrável/i)).toBeInTheDocument()
    expect(screen.getAllByText('Anulada').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /perdoar dívida/i })).not.toBeInTheDocument()
  })

  it('writes off a charge through a dialog that requires a reason', async () => {
    getClientLedgerMock.mockResolvedValue({
      entries: [{ type: 'CHARGE', date: '2026-01-01', description: 'Consultoria', amountCents: 50000, runningBalanceCents: 50000, chargeId: 'charge-1', writtenOff: false }],
      balanceCents: 50000,
      availableCreditCents: 0,
    })
    writeOffChargeMock.mockResolvedValue({})
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /perdoar dívida/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Anular cobrança' })
    const submit = within(dialog).getByRole('button', { name: /perdoar dívida/i })
    expect(submit).toBeDisabled()

    await userEvent.type(within(dialog).getByLabelText(/motivo/i), 'Insolvente')
    await userEvent.click(submit)

    await waitFor(() => expect(writeOffChargeMock).toHaveBeenCalledWith('charge-1', 'Insolvente'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // Spec §11: typed in euros, posted in cents.
  it('records a payment typed in euros, proposing then confirming, in cents on the wire', async () => {
    proposeAllocationMock.mockResolvedValue(PROPOSAL)
    recordPaymentMock.mockResolvedValue({ paymentId: 'p1' })
    renderSection()

    const dialog = await openPaymentDialog()
    await userEvent.type(within(dialog).getByLabelText(/^valor$/i), '2150,00')
    await userEvent.type(within(dialog).getByLabelText(/data de receção/i), '2026-09-03')
    await userEvent.click(within(dialog).getByRole('button', { name: /propor alocação/i }))

    await waitFor(() => expect(proposeAllocationMock).toHaveBeenCalledWith('c1', 215000))
    // The proposal names the charge, never its UUID.
    expect(await within(dialog).findByText(/retainer — 2026-01/i)).toBeInTheDocument()
    expect(within(dialog).queryByText('charge-1')).not.toBeInTheDocument()

    await afterConfirmGuard()
    await userEvent.click(within(dialog).getByRole('button', { name: /^confirmar$/i }))

    await waitFor(() =>
      expect(recordPaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({ amountCents: 215000, allocations: [{ chargeId: 'charge-1', amountCents: 215000 }] }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // Review Focus 1, at the form: refused, not posted a hundred times too large.
  it('cannot propose a payment typed with a dot as the decimal mark', async () => {
    renderSection()

    const dialog = await openPaymentDialog()
    await userEvent.type(within(dialog).getByLabelText(/^valor$/i), '2150.50')
    await userEvent.type(within(dialog).getByLabelText(/data de receção/i), '2026-09-03')

    expect(within(dialog).getByRole('button', { name: /propor alocação/i })).toBeDisabled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/indica um valor/i)
  })

  it('drops a stale proposal when the amount is edited', async () => {
    proposeAllocationMock.mockResolvedValue(PROPOSAL)
    renderSection()

    const dialog = await openPaymentDialog()
    const amount = within(dialog).getByLabelText(/^valor$/i)
    await userEvent.type(amount, '15')
    await userEvent.type(within(dialog).getByLabelText(/data de receção/i), '2026-01-10')
    await userEvent.click(within(dialog).getByRole('button', { name: /propor alocação/i }))
    expect(await within(dialog).findByText(/retainer — 2026-01/i)).toBeInTheDocument()

    // Correcting the amount must retract the proposal built from the old one,
    // or Confirmar would record the new amount against the old allocations.
    await userEvent.type(amount, '0')

    expect(within(dialog).queryByRole('button', { name: /^confirmar$/i })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /propor alocação/i })).toBeInTheDocument()
  })

  // A response that arrives after the amount changed belongs to the old amount.
  it('ignores a proposal that arrives after the amount was changed', async () => {
    let resolveProposal: (value: typeof PROPOSAL) => void = () => {}
    proposeAllocationMock.mockReturnValue(new Promise((resolve) => (resolveProposal = resolve)))
    renderSection()

    const dialog = await openPaymentDialog()
    const amount = within(dialog).getByLabelText(/^valor$/i)
    await userEvent.type(amount, '15')
    await userEvent.type(within(dialog).getByLabelText(/data de receção/i), '2026-01-10')
    await userEvent.click(within(dialog).getByRole('button', { name: /propor alocação/i }))
    await waitFor(() => expect(proposeAllocationMock).toHaveBeenCalledWith('c1', 1500))

    await userEvent.clear(amount)
    await userEvent.type(amount, '150')
    resolveProposal(PROPOSAL)

    await waitFor(() => expect(within(dialog).getByRole('button', { name: /propor alocação/i })).toBeInTheDocument())
    expect(within(dialog).queryByRole('button', { name: /^confirmar$/i })).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/retainer — 2026-01/i)).not.toBeInTheDocument()
    expect(recordPaymentMock).not.toHaveBeenCalled()
  })

  // Review Focus 3: leaving the field reformats it, which is not an edit.
  it('keeps the proposal when the amount field is merely left', async () => {
    proposeAllocationMock.mockResolvedValue(PROPOSAL)
    renderSection()

    const dialog = await openPaymentDialog()
    const amount = within(dialog).getByLabelText(/^valor$/i)
    await userEvent.type(amount, '2150')
    await userEvent.type(within(dialog).getByLabelText(/data de receção/i), '2026-01-10')
    await userEvent.click(within(dialog).getByRole('button', { name: /propor alocação/i }))
    expect(await within(dialog).findByText(/retainer — 2026-01/i)).toBeInTheDocument()

    await userEvent.click(amount)
    await userEvent.tab()

    expect(within(dialog).getByRole('button', { name: /^confirmar$/i })).toBeInTheDocument()
  })

  it('creates an ad-hoc charge typed in euros', async () => {
    createAdHocChargeMock.mockResolvedValue({ id: 'charge-1' })
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /nova cobrança avulsa/i }))
    const dialog = await screen.findByRole('dialog', { name: /nova cobrança avulsa/i })
    await userEvent.type(within(dialog).getByLabelText(/descrição/i), 'Consultoria extra')
    await userEvent.type(within(dialog).getByLabelText(/^valor$/i), '150,00')
    await userEvent.type(within(dialog).getByLabelText(/data de vencimento/i), '2026-10-01')
    await userEvent.click(within(dialog).getByRole('button', { name: /^criar$/i }))

    await waitFor(() =>
      expect(createAdHocChargeMock).toHaveBeenCalledWith({
        clientId: 'c1',
        description: 'Consultoria extra',
        amountCents: 15000,
        dueOn: '2026-10-01',
      }),
    )
  })

  // Review Focus 5.
  it('keeps the new-charge dialog open, with what was typed, when the charge is refused', async () => {
    createAdHocChargeMock.mockRejectedValue(new ApiError('common.internal_error', {}, 500))
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /nova cobrança avulsa/i }))
    const dialog = await screen.findByRole('dialog', { name: /nova cobrança avulsa/i })
    await userEvent.type(within(dialog).getByLabelText(/descrição/i), 'Consultoria extra')
    await userEvent.type(within(dialog).getByLabelText(/^valor$/i), '150,00')
    await userEvent.type(within(dialog).getByLabelText(/data de vencimento/i), '2026-10-01')
    await userEvent.click(within(dialog).getByRole('button', { name: /^criar$/i }))

    expect(await within(dialog).findByText(/ocorreu um erro no servidor/i)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/descrição/i)).toHaveValue('Consultoria extra')
  })

  it('keeps the write-off dialog open, with the reason, when the write-off is refused', async () => {
    getClientLedgerMock.mockResolvedValue({
      entries: [{ type: 'CHARGE', date: '2026-01-01', description: 'Consultoria', amountCents: 50000, runningBalanceCents: 50000, chargeId: 'charge-1', writtenOff: false }],
      balanceCents: 50000,
      availableCreditCents: 0,
    })
    writeOffChargeMock.mockRejectedValue(new ApiError('common.internal_error', {}, 500))
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /perdoar dívida/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Anular cobrança' })
    await userEvent.type(within(dialog).getByLabelText(/motivo/i), 'Insolvente')
    await userEvent.click(within(dialog).getByRole('button', { name: /perdoar dívida/i }))

    expect(await within(dialog).findByText(/ocorreu um erro no servidor/i)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/motivo/i)).toHaveValue('Insolvente')
  })

  it('keeps the payment dialog open, with the amount, when the payment is refused', async () => {
    proposeAllocationMock.mockResolvedValue(PROPOSAL)
    recordPaymentMock.mockRejectedValue(new ApiError('common.internal_error', {}, 500))
    renderSection()

    const dialog = await openPaymentDialog()
    await userEvent.type(within(dialog).getByLabelText(/^valor$/i), '2150,00')
    await userEvent.type(within(dialog).getByLabelText(/data de receção/i), '2026-09-03')
    await userEvent.click(within(dialog).getByRole('button', { name: /propor alocação/i }))
    const confirmButton = await within(dialog).findByRole('button', { name: /^confirmar$/i })
    await afterConfirmGuard()
    await userEvent.click(confirmButton)

    expect(await within(dialog).findByText(/ocorreu um erro no servidor/i)).toBeInTheDocument()
    // Leaving the field reformats it (2 150,00); what matters is it kept the amount.
    expect((within(dialog).getByLabelText(/^valor$/i) as HTMLInputElement).value.replace(/\s/g, '')).toBe('2150,00')
  })

  it('ignores a second click on Confirmar right after the proposal appears, then confirms', async () => {
    proposeAllocationMock.mockResolvedValue(PROPOSAL)
    recordPaymentMock.mockResolvedValue({ paymentId: 'p1' })
    renderSection()

    const dialog = await openPaymentDialog()
    await userEvent.type(within(dialog).getByLabelText(/^valor$/i), '2150,00')
    await userEvent.type(within(dialog).getByLabelText(/data de receção/i), '2026-09-03')
    const submit = within(dialog).getByRole('button', { name: /propor alocação/i })
    await userEvent.click(submit)
    // The double-click's second press lands on the same slot, now Confirmar.
    await userEvent.click(await within(dialog).findByRole('button', { name: /^confirmar$/i }))
    expect(recordPaymentMock).not.toHaveBeenCalled()

    await afterConfirmGuard()
    await userEvent.click(within(dialog).getByRole('button', { name: /^confirmar$/i }))
    await waitFor(() => expect(recordPaymentMock).toHaveBeenCalledTimes(1))
  })

  it('drops a refused proposal error when the amount changes', async () => {
    proposeAllocationMock.mockRejectedValue(new ApiError('common.internal_error', {}, 500))
    renderSection()

    const dialog = await openPaymentDialog()
    const amount = within(dialog).getByLabelText(/^valor$/i)
    await userEvent.type(amount, '2150,00')
    await userEvent.type(within(dialog).getByLabelText(/data de receção/i), '2026-09-03')
    await userEvent.click(within(dialog).getByRole('button', { name: /propor alocação/i }))
    expect(await within(dialog).findByText(/ocorreu um erro no servidor/i)).toBeInTheDocument()

    await userEvent.type(amount, '1')
    expect(within(dialog).queryByText(/ocorreu um erro no servidor/i)).not.toBeInTheDocument()
  })

  it('opens the retainer plan dialog from its card', async () => {
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /criar plano de retainer/i }))

    expect(await screen.findByRole('dialog', { name: /criar plano de retainer/i })).toBeInTheDocument()
  })

  it('shows the ageing card only when the client has a receivables row', async () => {
    getReceivablesMock.mockResolvedValue([
      { clientId: 'c1', clientName: 'X', grossOutstandingCents: 9000, creditCents: 0, outstandingCents: 9000, oldestDueOn: '2026-01-08', ageingBucket: '0-30' },
    ])
    renderSection()

    expect(await screen.findByRole('heading', { name: 'Antiguidade' })).toBeInTheDocument()
  })
})
