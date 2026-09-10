import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ConnectionStatus } from './ConnectionStatus'

await initI18n()

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderStatus(queryClient: QueryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ConnectionStatus />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('ConnectionStatus', () => {
  it('announces that the server is unreachable when offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderStatus()

    expect(screen.getByText(/sem ligação ao servidor|no connection/i)).toBeInTheDocument()
  })

  it('says nothing alarming when online', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    renderStatus()

    expect(screen.queryByText(/sem ligação ao servidor|no connection/i)).not.toBeInTheDocument()
  })

  it('shows the formatted last-sync time for a query that has already succeeded', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    const knownTime = new Date('2026-01-15T10:30:00Z').getTime()
    const queryClient = new QueryClient()
    queryClient.setQueryData(['clients'], { ok: true }, { updatedAt: knownTime })

    const expectedTime = new Intl.DateTimeFormat(i18next.language, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(knownTime))

    renderStatus(queryClient)

    expect(screen.getByText(new RegExp(escapeRegExp(expectedTime)))).toBeInTheDocument()
  })

  it('shows no last-sync text when no cached query has ever succeeded', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderStatus()

    expect(screen.queryByText(/última sincronização|last synchronised/i)).not.toBeInTheDocument()
  })
})
