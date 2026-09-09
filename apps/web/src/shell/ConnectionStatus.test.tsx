import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ConnectionStatus } from './ConnectionStatus'

await initI18n()

function renderStatus() {
  const queryClient = new QueryClient()

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
})
