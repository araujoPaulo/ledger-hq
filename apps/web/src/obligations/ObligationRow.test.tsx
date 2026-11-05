import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const { ObligationRow } = await import('./ObligationRow')

await initI18n()
await i18next.changeLanguage('pt-PT')

const baseObligation = {
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

function renderRow(overrides: Partial<typeof baseObligation> = {}, props: { showClient?: boolean } = {}) {
  const onMarkDone = vi.fn()
  const onEdit = vi.fn()
  render(
    <I18nextProvider i18n={i18next}>
      <ObligationRow
        obligation={{ ...baseObligation, ...overrides }}
        showClient={props.showClient ?? false}
        onMarkDone={onMarkDone}
        onEdit={onEdit}
      />
    </I18nextProvider>,
  )
  return { onMarkDone, onEdit }
}

describe('ObligationRow', () => {
  it('shows the obligation name and due date', () => {
    renderRow()
    expect(screen.getByText(/declaração periódica de iva/i)).toBeInTheDocument()
    expect(screen.getByText('20/03/2026')).toBeInTheDocument()
  })

  // V2: at phone width the title takes the full row and the badge/actions wrap beneath it.
  it('gives the title the full row on a phone and shares it from sm up', () => {
    renderRow()
    const column = screen.getByText(/declaração periódica de iva/i).parentElement
    expect(column).toHaveClass('basis-full', 'sm:basis-0', 'min-w-0')
  })

  it('shows the client name only when showClient is true', () => {
    renderRow({}, { showClient: false })
    expect(screen.queryByText(/padaria central/i)).not.toBeInTheDocument()
  })

  it('shows the client name when showClient is true', () => {
    renderRow({}, { showClient: true })
    expect(screen.getByText(/padaria central/i)).toBeInTheDocument()
  })

  it('calls onMarkDone when the mark-done button is clicked', async () => {
    const { onMarkDone } = renderRow()
    await userEvent.click(screen.getByRole('button', { name: /marcar como feita/i }))
    expect(onMarkDone).toHaveBeenCalledTimes(1)
  })

  it('hides the mark-done and edit actions once the obligation is DONE', () => {
    renderRow({ status: 'DONE' })
    expect(screen.queryByRole('button', { name: /marcar como feita/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^editar$/i })).not.toBeInTheDocument()
  })

  it('shows the period under the name, readable when it is a quarter', () => {
    renderRow({ periodLabel: '2026-Q1' })
    expect(screen.getByText('1.º trimestre de 2026')).toBeInTheDocument()
  })

  it('marks an overdue due date in danger red', () => {
    renderRow({ dueDate: '2020-01-31' })
    expect(screen.getByText('31/01/2020').parentElement).toHaveClass('text-danger-700')
  })

  it('does not mark a future due date', () => {
    renderRow({ dueDate: '2999-01-31' })
    expect(screen.getByText('31/01/2999').parentElement).not.toHaveClass('text-danger-700')
  })

  it('flags a due date changed by hand, in words for a screen reader', () => {
    renderRow({ dueDateOverridden: true })
    expect(screen.getByText('Data alterada manualmente')).toHaveClass('sr-only')
  })

  it('shows a status badge only when the status is not pending', () => {
    renderRow()
    expect(screen.queryByText('Pendente')).not.toBeInTheDocument()
  })

  it('shows the in-progress status as a badge', () => {
    renderRow({ status: 'IN_PROGRESS' })
    expect(screen.getByText('Em curso')).toBeInTheDocument()
  })

  it('offers Edit as a button when the section passes onEdit', async () => {
    const { onEdit } = renderRow()
    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})
