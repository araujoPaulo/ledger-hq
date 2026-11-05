import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { initI18n } from '../i18n'

const getCurrentRetainerPlan = vi.hoisted(() => vi.fn())
const createRetainerPlan = vi.hoisted(() => vi.fn())
const renewRetainerPlan = vi.hoisted(() => vi.fn())
const getReceivables = vi.hoisted(() => vi.fn())
const applyCredit = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getCurrentRetainerPlan, createRetainerPlan, renewRetainerPlan, getReceivables, applyCredit }))

const { RetainerPlanCard } = await import('./RetainerPlanCard')
const { AgeingCard } = await import('./AgeingCard')
const { CreditCard } = await import('./CreditCard')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderWith(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18next}>{children}</I18nextProvider>
      </QueryClientProvider>,
    ),
  }
}

const plan = {
  id: 'plan-1',
  clientId: 'c1',
  amountCents: 9000,
  periodicity: 'MONTHLY',
  dueDayOfMonth: 8,
  validFrom: '2026-01-01',
  validTo: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RetainerPlanCard', () => {
  it('says there is no plan, and offers to create one in a dialog typed in euros', async () => {
    getCurrentRetainerPlan.mockResolvedValue(null)
    createRetainerPlan.mockResolvedValue(plan)
    const onSaved = vi.fn()
    renderWith(<RetainerPlanCard clientId="c1" onSaved={onSaved} />)

    expect(await screen.findByText('Sem avença em vigor.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /criar plano de retainer/i }))

    const dialog = await screen.findByRole('dialog', { name: /criar plano de retainer/i })
    await userEvent.type(within(dialog).getByLabelText(/valor mensal/i), '90,00')
    await userEvent.clear(within(dialog).getByLabelText(/dia de vencimento/i))
    await userEvent.type(within(dialog).getByLabelText(/dia de vencimento/i), '8')
    await userEvent.type(within(dialog).getByLabelText(/em vigor desde/i), '2026-01-01')
    await userEvent.click(within(dialog).getByRole('button', { name: /^guardar$/i }))

    await waitFor(() =>
      expect(createRetainerPlan).toHaveBeenCalledWith('c1', {
        amountCents: 9000,
        periodicity: 'MONTHLY',
        dueDayOfMonth: 8,
        validFrom: '2026-01-01',
      }),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('describes the plan in force and offers to update the fee', async () => {
    getCurrentRetainerPlan.mockResolvedValue(plan)
    renewRetainerPlan.mockResolvedValue({ closedPlanId: 'plan-1', newPlanId: 'plan-2' })
    renderWith(<RetainerPlanCard clientId="c1" onSaved={() => {}} />)

    expect(await screen.findByText('Mensal')).toBeInTheDocument()
    expect(screen.getByText('01/01/2026')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /atualizar valor/i }))

    const dialog = await screen.findByRole('dialog', { name: /atualizar valor/i })
    expect(within(dialog).queryByLabelText(/periodicidade/i)).not.toBeInTheDocument()
    // "Novo valor" alone: the date is "Novo valor a partir de".
    await userEvent.type(within(dialog).getByLabelText(/^novo valor$/i), '120')
    await userEvent.type(within(dialog).getByLabelText(/a partir de/i), '2026-06-01')
    await userEvent.click(within(dialog).getByRole('button', { name: /^guardar$/i }))

    await waitFor(() =>
      expect(renewRetainerPlan).toHaveBeenCalledWith('c1', { newAmountCents: 12000, effectiveFrom: '2026-06-01' }),
    )
  })

  it('renders the start date when the API sends a full ISO timestamp', async () => {
    // The API serialises the plan's Date column as a timestamp, not a date.
    getCurrentRetainerPlan.mockResolvedValue({ ...plan, validFrom: '2026-01-01T00:00:00.000Z' })
    renderWith(<RetainerPlanCard clientId="c1" onSaved={() => {}} />)

    expect(await screen.findByText('01/01/2026')).toBeInTheDocument()
  })

  it('cannot be saved without a positive amount', async () => {
    getCurrentRetainerPlan.mockResolvedValue(null)
    renderWith(<RetainerPlanCard clientId="c1" onSaved={() => {}} />)

    await userEvent.click(await screen.findByRole('button', { name: /criar plano de retainer/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/valor mensal/i), '0')
    await userEvent.type(within(dialog).getByLabelText(/em vigor desde/i), '2026-01-01')

    expect(within(dialog).getByRole('button', { name: /^guardar$/i })).toBeDisabled()
  })
})

describe('RetainerPlanCard failures', () => {
  it('keeps the dialog open, the typed amount, and shows the server message when saving fails', async () => {
    getCurrentRetainerPlan.mockResolvedValue(null)
    createRetainerPlan.mockRejectedValue(new ApiError('common.not_found', {}, 404))
    const onSaved = vi.fn()
    renderWith(<RetainerPlanCard clientId="c1" onSaved={onSaved} />)

    await userEvent.click(await screen.findByRole('button', { name: /criar plano de retainer/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/valor mensal/i), '90,00')
    await userEvent.type(within(dialog).getByLabelText(/em vigor desde/i), '2026-01-01')
    await userEvent.click(within(dialog).getByRole('button', { name: /^guardar$/i }))

    expect(await within(dialog).findByText(/registo não encontrado/i)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/valor mensal/i)).toHaveValue('90,00')
    expect(onSaved).not.toHaveBeenCalled()
  })
})

describe('AgeingCard', () => {
  it('renders nothing for a client with nothing outstanding', async () => {
    getReceivables.mockResolvedValue([])
    const { container, queryClient } = renderWith(<AgeingCard clientId="c1" />)

    await waitFor(() => expect(queryClient.getQueryState(['receivables'])?.status).toBe('success'))
    expect(container).toBeEmptyDOMElement()
  })

  it("shows the client's bucket, amount and oldest due date", async () => {
    getReceivables.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Padaria Central',
        grossOutstandingCents: 27_000,
        creditCents: 0,
        outstandingCents: 27_000,
        oldestDueOn: '2026-01-08',
        ageingBucket: '61-90',
      },
    ])
    renderWith(<AgeingCard clientId="c1" />)

    expect(await screen.findByText('61-90 dias')).toBeInTheDocument()
    expect(screen.getByText(/vence a 08\/01\/2026/i)).toBeInTheDocument()
  })
})

describe('CreditCard', () => {
  const proposal = {
    proposed: [{ paymentId: 'p1', chargeId: 'ch1', amountCents: 9000, description: 'Retainer — 2026-01', periodLabel: '2026-01', dueOn: '2026-01-08' }],
    remainingCreditCents: 18000,
    allocated: 0,
  }

  it('renders nothing without credit', () => {
    const { container } = renderWith(<CreditCard clientId="c1" availableCreditCents={0} onApplied={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('proposes first, shows the proposal in a dialog, and only writes on Confirm', async () => {
    applyCredit.mockResolvedValueOnce(proposal).mockResolvedValueOnce({ proposed: [], remainingCreditCents: 18000, allocated: 1 })
    const onApplied = vi.fn()
    renderWith(<CreditCard clientId="c1" availableCreditCents={27000} onApplied={onApplied} />)

    expect(screen.getByRole('region', { name: 'Crédito disponível' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /aplicar crédito/i }))

    const dialog = await screen.findByRole('dialog', { name: 'Crédito disponível' })
    expect(within(dialog).getByText(/retainer — 2026-01/i)).toBeInTheDocument()
    expect(applyCredit).toHaveBeenLastCalledWith('c1', true)

    await userEvent.click(within(dialog).getByRole('button', { name: /^confirmar$/i }))

    await waitFor(() =>
      expect(applyCredit).toHaveBeenLastCalledWith('c1', false, [{ paymentId: 'p1', chargeId: 'ch1', amountCents: 9000 }]),
    )
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('says so in the dialog when there is nothing due to spend the credit on', async () => {
    applyCredit.mockResolvedValueOnce({ proposed: [], remainingCreditCents: 27000, allocated: 0 })
    renderWith(<CreditCard clientId="c1" availableCreditCents={27000} onApplied={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: /aplicar crédito/i }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/não há cobranças vencidas/i)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /^confirmar$/i })).not.toBeInTheDocument()
  })

  it('keeps the dialog open and shows the server message when confirming fails', async () => {
    applyCredit.mockResolvedValueOnce(proposal).mockRejectedValueOnce(new ApiError('common.not_found', {}, 404))
    const onApplied = vi.fn()
    renderWith(<CreditCard clientId="c1" availableCreditCents={27000} onApplied={onApplied} />)

    await userEvent.click(screen.getByRole('button', { name: /aplicar crédito/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /^confirmar$/i }))

    expect(await within(dialog).findByText(/registo não encontrado/i)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onApplied).not.toHaveBeenCalled()
  })
})
