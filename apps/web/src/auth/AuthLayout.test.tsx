import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { initI18n } from '../i18n'
import { AuthLayout } from './AuthLayout'
import { AuthSplash } from './AuthSplash'

await initI18n()
// See LoginPage.test.tsx: jsdom reports "en-US" regardless of the host.
await i18next.changeLanguage('pt-PT')

function renderWithProviders(node: ReactNode) {
  // ConnectionStatus reads the query cache for its last-sync time.
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>{node}</I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('AuthLayout', () => {
  it('renders the page inside the card, with the mark and the language menu', () => {
    renderWithProviders(
      <AuthLayout>
        <h1>Entrar</h1>
      </AuthLayout>,
    )

    const heading = screen.getByRole('heading', { level: 1, name: 'Entrar' })
    expect(heading).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByText('Entrar')).toBe(heading)
    expect(heading.parentElement).toHaveClass('border', 'bg-surface')
    expect(screen.getByText('Ledger HQ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Idioma' })).toBeInTheDocument()
  })

  it('has no navigation and exactly one main landmark', () => {
    renderWithProviders(
      <AuthLayout>
        <p>conteúdo</p>
      </AuthLayout>,
    )

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  // The mark must sit at the same y on the splash and on every card, so the
  // column is top-anchored at every width (never vertically centred).
  it('top-anchors the column at every width, in the layout and the splash', () => {
    const { unmount } = renderWithProviders(
      <AuthLayout>
        <p>conteúdo</p>
      </AuthLayout>,
    )
    expect(screen.getByRole('main').className).not.toMatch(/items-center/)
    unmount()

    renderWithProviders(<AuthSplash />)
    expect(screen.getByRole('main').className).not.toMatch(/items-center/)
  })
})

describe('AuthSplash', () => {
  it('announces loading once and shows the mark without controls', () => {
    const { container } = renderWithProviders(<AuthSplash />)

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('A carregar')
    expect(screen.getByText('Ledger HQ')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})
