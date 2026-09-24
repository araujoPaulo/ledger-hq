import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const getClientLedgerMock = vi.hoisted(() => vi.fn())
const proposeAllocationMock = vi.hoisted(() => vi.fn())
const recordPaymentMock = vi.hoisted(() => vi.fn())
const writeOffChargeMock = vi.hoisted(() => vi.fn())
const getCurrentRetainerPlanMock = vi.hoisted(() => vi.fn())
const createAdHocChargeMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({
  getClientLedger: getClientLedgerMock,
  proposeAllocation: proposeAllocationMock,
  recordPayment: recordPaymentMock,
  writeOffCharge: writeOffChargeMock,
  getCurrentRetainerPlan: getCurrentRetainerPlanMock,
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

describe('ClientLedgerSection', () => {
  beforeEach(() => {
    getClientLedgerMock.mockReset()
  })

  it('shows the empty state with no billing history', async () => {
    getClientLedgerMock.mockResolvedValue({ entries: [], balanceCents: 0 })
    renderSection()
    expect(await screen.findByText(/sem movimentos de faturação/i)).toBeInTheDocument()
  })

  it('lists charge and payment entries with the running balance', async () => {
    getClientLedgerMock.mockResolvedValue({
      entries: [
        { type: 'CHARGE', date: '2026-01-01', description: 'Retainer — 2026-01', amountCents: 9000, runningBalanceCents: 9000 },
        { type: 'PAYMENT', date: '2026-01-10', description: 'Pagamento — TRANSFER', amountCents: -9000, runningBalanceCents: 0 },
      ],
      balanceCents: 0,
    })
    renderSection()
    expect(await screen.findByText(/retainer — 2026-01/i)).toBeInTheDocument()
    expect(screen.getByText(/pagamento — transfer/i)).toBeInTheDocument()
  })

  it('records a payment through the propose-then-confirm flow', async () => {
    getClientLedgerMock.mockResolvedValue({ entries: [], balanceCents: 0 })
    proposeAllocationMock.mockResolvedValue({
      proposed: [{ chargeId: 'charge-1', amountCents: 9000, description: 'Retainer — 2026-01', periodLabel: '2026-01', dueOn: '2026-01-08' }],
      excessCents: 0,
    })
    recordPaymentMock.mockResolvedValue({ paymentId: 'p1' })
    renderSection()

    const form = await screen.findByRole('region', { name: /registar pagamento/i })
    await userEvent.type(within(form).getByLabelText(/valor \(cêntimos\)/i), '9000')
    await userEvent.type(within(form).getByLabelText(/data de receção/i), '2026-09-03')
    await userEvent.click(within(form).getByRole('button', { name: /propor alocação/i }))

    // The proposal row names the charge; the chargeId is no longer rendered
    // (it was a UUID the operator could not check anything against).
    expect(await within(form).findByText(/retainer — 2026-01/i)).toBeInTheDocument()
    await userEvent.click(within(form).getByRole('button', { name: /confirmar/i }))

    expect(recordPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 9000, allocations: [{ chargeId: 'charge-1', amountCents: 9000 }] }),
    )
  })

  it('shows the renew form, not the create form, when a plan is already in force', async () => {
    getClientLedgerMock.mockResolvedValue({ entries: [], balanceCents: 0 })
    getCurrentRetainerPlanMock.mockResolvedValue({ id: 'plan-1', clientId: 'c1', amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-01-01', validTo: null })
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^editar$/i }))

    expect(await screen.findByText(/atualizar valor/i)).toBeInTheDocument()
    expect(screen.queryByText(/criar plano de retainer/i)).not.toBeInTheDocument()
  })

  it('shows the proposal by charge description, and sends only the allocation fields', async () => {
    getClientLedgerMock.mockResolvedValue({ entries: [], balanceCents: 0 })
    getCurrentRetainerPlanMock.mockResolvedValue(null)
    proposeAllocationMock.mockResolvedValue({
      proposed: [{ chargeId: 'charge-1', amountCents: 9000, description: 'Retainer — 2026-01', periodLabel: '2026-01', dueOn: '2026-01-08' }],
      excessCents: 0,
    })
    recordPaymentMock.mockResolvedValue({ paymentId: 'p1' })
    renderSection()

    const form = await screen.findByRole('region', { name: /registar pagamento/i })
    await userEvent.type(within(form).getByLabelText(/valor \(cêntimos\)/i), '9000')
    await userEvent.type(within(form).getByLabelText(/data de receção/i), '2026-01-10')
    await userEvent.click(within(form).getByRole('button', { name: /propor alocação/i }))

    // The operator reviews the proposal before confirming, so the row has to
    // name the charge, not show a UUID.
    expect(await within(form).findByText(/retainer — 2026-01/i)).toBeInTheDocument()
    expect(within(form).queryByText('charge-1')).not.toBeInTheDocument()

    await userEvent.click(within(form).getByRole('button', { name: /^confirmar$/i }))

    expect(recordPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({ allocations: [{ chargeId: 'charge-1', amountCents: 9000 }] }),
    )
  })

  it('drops a stale proposal when the payment amount is edited', async () => {
    getClientLedgerMock.mockResolvedValue({ entries: [], balanceCents: 0 })
    getCurrentRetainerPlanMock.mockResolvedValue(null)
    proposeAllocationMock.mockResolvedValue({
      proposed: [{ chargeId: 'charge-1', amountCents: 1500, description: 'Retainer — 2026-01', periodLabel: '2026-01', dueOn: '2026-01-08' }],
      excessCents: 0,
    })
    renderSection()

    const form = await screen.findByRole('region', { name: /registar pagamento/i })
    const amount = within(form).getByLabelText(/valor \(cêntimos\)/i)
    await userEvent.type(amount, '1500')
    await userEvent.type(within(form).getByLabelText(/data de receção/i), '2026-01-10')
    await userEvent.click(within(form).getByRole('button', { name: /propor alocação/i }))
    expect(await within(form).findByText(/retainer — 2026-01/i)).toBeInTheDocument()

    // Correcting the amount must retract the proposal built from the old one,
    // or Confirmar would record the new amount against the old allocations.
    await userEvent.type(amount, '0')

    expect(within(form).queryByRole('button', { name: /^confirmar$/i })).not.toBeInTheDocument()
    expect(within(form).getByRole('button', { name: /propor alocação/i })).toBeInTheDocument()
  })

  it('offers no write-off control on a charge that is already written off', async () => {
    getCurrentRetainerPlanMock.mockResolvedValue(null)
    getClientLedgerMock.mockResolvedValue({
      entries: [
        { type: 'CHARGE', date: '2026-01-01', description: 'Incobrável', amountCents: 50000, runningBalanceCents: 50000, chargeId: 'charge-1', writtenOff: true },
        { type: 'WRITE_OFF', date: '2026-02-01', description: 'Insolvente', amountCents: -50000, runningBalanceCents: 0, chargeId: 'charge-1', writtenOff: true },
      ],
      balanceCents: 0,
    })
    renderSection()

    expect(await screen.findByText(/incobrável/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /perdoar dívida/i })).not.toBeInTheDocument()
  })

  it('creates an ad-hoc charge', async () => {
    getClientLedgerMock.mockResolvedValue({ entries: [], balanceCents: 0 })
    getCurrentRetainerPlanMock.mockResolvedValue(null)
    createAdHocChargeMock.mockResolvedValue({ id: 'charge-1' })
    renderSection()

    const form = await screen.findByRole('form', { name: /nova cobrança avulsa/i })
    await userEvent.type(within(form).getByLabelText(/descrição/i), 'Consultoria extra')
    await userEvent.type(within(form).getByLabelText(/valor \(cêntimos\)/i), '15000')
    await userEvent.type(within(form).getByLabelText(/data de vencimento/i), '2026-10-01')
    await userEvent.click(within(form).getByRole('button', { name: /^criar$/i }))

    expect(createAdHocChargeMock).toHaveBeenCalledWith({
      clientId: 'c1',
      description: 'Consultoria extra',
      amountCents: 15000,
      dueOn: '2026-10-01',
    })
  })
})
