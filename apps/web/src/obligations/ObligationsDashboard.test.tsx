import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const listObligationsMock = vi.hoisted(() => vi.fn())
const patchObligationMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ listObligations: listObligationsMock, patchObligation: patchObligationMock }))

const { ObligationsDashboard } = await import('./ObligationsDashboard')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ObligationsDashboard />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

const overdueObligation = {
  id: 'o1',
  clientId: 'c1',
  clientName: 'Padaria Central, Lda.',
  definitionCode: 'VAT_MONTHLY_RETURN',
  definitionName: 'Declaração periódica de IVA',
  authority: 'TAX',
  periodLabel: '2026-01',
  dueDate: '2020-01-01', // deep in the past relative to any real "today"
  dueDateOverridden: false,
  status: 'PENDING',
  completedAt: null,
  reference: null,
  amountCents: null,
  notes: null,
}

describe('ObligationsDashboard', () => {
  beforeEach(() => {
    listObligationsMock.mockReset()
    patchObligationMock.mockReset()
  })

  it('shows the empty state when there are no obligations', async () => {
    listObligationsMock.mockResolvedValue([])
    renderDashboard()
    expect(await screen.findByText(/sem obrigações pendentes/i)).toBeInTheDocument()
  })

  it('groups an overdue obligation under the "Atrasadas" section, with the client name shown', async () => {
    listObligationsMock.mockResolvedValue([overdueObligation])
    renderDashboard()

    expect(await screen.findByText(/atrasadas/i)).toBeInTheDocument()
    expect(screen.getByText(/padaria central/i)).toBeInTheDocument()
  })

  it('marking an obligation done calls patchObligation with status DONE', async () => {
    listObligationsMock.mockResolvedValue([overdueObligation])
    patchObligationMock.mockResolvedValue({ ...overdueObligation, status: 'DONE' })
    renderDashboard()

    await userEvent.click(await screen.findByRole('button', { name: /marcar como feita/i }))

    expect(patchObligationMock).toHaveBeenCalledWith('o1', { status: 'DONE' })
  })
})
