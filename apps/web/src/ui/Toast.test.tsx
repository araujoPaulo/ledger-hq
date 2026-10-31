import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ToastProvider, useToast } from './Toast'

await initI18n()
await i18next.changeLanguage('pt-PT')

function CopyButton() {
  const { toast } = useToast()
  return (
    <button type="button" onClick={() => toast({ title: 'Palavra-passe copiada.', tone: 'success' })}>
      Copiar
    </button>
  )
}

function renderWithProvider() {
  return render(
    <I18nextProvider i18n={i18next}>
      <ToastProvider>
        <CopyButton />
      </ToastProvider>
    </I18nextProvider>,
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Toast', () => {
  it('shows the title in the translated notifications region', async () => {
    renderWithProvider()

    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }))

    const region = screen.getByRole('region', { name: /notificações/i })
    expect(await within(region).findByText('Palavra-passe copiada.')).toBeInTheDocument()
    // Radix portals its visually hidden live announcer to <body>, outside the region.
    expect(await screen.findByRole('status')).toBeInTheDocument()
  })

  it('disappears after four seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProvider()

    await user.click(screen.getByRole('button', { name: 'Copiar' }))
    const region = screen.getByRole('region', { name: /notificações/i })
    expect(await within(region).findByText('Palavra-passe copiada.')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_500)
    })

    expect(within(region).queryByText('Palavra-passe copiada.')).not.toBeInTheDocument()
  })

  // A missing provider is a wiring bug, not something to swallow silently.
  it('refuses to work outside its provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<CopyButton />)).toThrow(/ToastProvider/)

    consoleError.mockRestore()
  })
})
