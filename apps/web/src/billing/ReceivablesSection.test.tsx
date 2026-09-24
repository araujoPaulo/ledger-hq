import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const getReceivablesMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getReceivables: getReceivablesMock }))

const { ReceivablesSection } = await import('./ReceivablesSection')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ReceivablesSection />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('ReceivablesSection', () => {
  beforeEach(() => {
    getReceivablesMock.mockReset()
  })

  it('shows the empty state when nothing is outstanding', async () => {
    getReceivablesMock.mockResolvedValue([])
    renderSection()
    expect(await screen.findByText(/sem valores em atraso/i)).toBeInTheDocument()
  })

  it('lists a client with an outstanding balance and its ageing bucket', async () => {
    getReceivablesMock.mockResolvedValue([
      { clientId: 'c1', clientName: 'Padaria Central', outstandingCents: 27000, oldestDueOn: '2026-01-08', ageingBucket: '61-90' },
    ])
    renderSection()
    expect(await screen.findByText(/padaria central/i)).toBeInTheDocument()
    expect(screen.getByText(/61-90/)).toBeInTheDocument()
  })
})
