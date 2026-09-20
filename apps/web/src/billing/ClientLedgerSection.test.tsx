import { render, screen } from '@testing-library/react'
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
vi.mock('./api', () => ({
  getClientLedger: getClientLedgerMock,
  proposeAllocation: proposeAllocationMock,
  recordPayment: recordPaymentMock,
  writeOffCharge: writeOffChargeMock,
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
    proposeAllocationMock.mockResolvedValue({ proposed: [{ chargeId: 'charge-1', amountCents: 9000 }], excessCents: 0 })
    recordPaymentMock.mockResolvedValue({ paymentId: 'p1' })
    renderSection()

    await userEvent.type(await screen.findByLabelText(/valor \(cêntimos\)/i), '9000')
    await userEvent.type(screen.getByLabelText(/data de receção/i), '2026-09-03')
    await userEvent.click(screen.getByRole('button', { name: /propor alocação/i }))

    expect(await screen.findByText(/charge-1/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(recordPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 9000, allocations: [{ chargeId: 'charge-1', amountCents: 9000 }] }),
    )
  })
})
