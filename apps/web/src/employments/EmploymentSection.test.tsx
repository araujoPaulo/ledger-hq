import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const listEmployments = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ listEmployments, createEmployment: vi.fn(), endEmployment: vi.fn() }))
vi.mock('../clients/api', () => ({ listClients: vi.fn().mockResolvedValue([]) }))

const { EmploymentSection } = await import('./EmploymentSection')

await initI18n()

const spell = {
  id: 'e1',
  employerId: 'c1',
  employerName: 'Padaria Central, Lda.',
  employeeId: 'p1',
  employeeName: 'Maria Santos',
  startedOn: '2024-01-15',
  endedOn: null,
  jobTitle: 'Bookkeeper',
  notes: null,
}

function renderSection(kind: 'COMPANY' | 'INDIVIDUAL', id: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <EmploymentSection client={{ id, kind, name: 'X' }} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('EmploymentSection', () => {
  it('shows the counterparty name from a company page', async () => {
    listEmployments.mockResolvedValue([spell])
    renderSection('COMPANY', 'c1')

    expect(await screen.findByText('Maria Santos')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /empregados|employees/i })).toBeInTheDocument()
  })

  it('shows the counterparty name from a person page', async () => {
    listEmployments.mockResolvedValue([spell])
    renderSection('INDIVIDUAL', 'p1')

    expect(await screen.findByText('Padaria Central, Lda.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /vínculos|employments/i })).toBeInTheDocument()
  })

  it('marks an open spell as current', async () => {
    listEmployments.mockResolvedValue([spell])
    renderSection('COMPANY', 'c1')

    expect(await screen.findByText(/em vigor|current/i)).toBeInTheDocument()
  })

  it('renders dates in day-first format', async () => {
    listEmployments.mockResolvedValue([{ ...spell, endedOn: '2025-06-30' }])
    renderSection('COMPANY', 'c1')

    expect(await screen.findByText(/15\/01\/2024/)).toBeInTheDocument()
    expect(screen.getByText(/30\/06\/2025/)).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    listEmployments.mockResolvedValue([])
    renderSection('COMPANY', 'c1')

    expect(await screen.findByText(/sem vínculos|no employment/i)).toBeInTheDocument()
  })
})
