import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const listPlatformsMock = vi.hoisted(() => vi.fn())
const createPlatformMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ listPlatforms: listPlatformsMock, createPlatform: createPlatformMock }))

const { PlatformsPage } = await import('./PlatformsPage')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <PlatformsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('PlatformsPage', () => {
  beforeEach(() => {
    listPlatformsMock.mockReset()
    createPlatformMock.mockReset()
  })

  it('lists existing platforms', async () => {
    listPlatformsMock.mockResolvedValue([
      { id: 'p1', name: 'Portal das Finanças', url: null, authKind: 'PASSWORD' },
    ])
    renderPage()
    expect(await screen.findByText('Portal das Finanças')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    listPlatformsMock.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/ainda não há plataformas/i)).toBeInTheDocument()
  })

  it('creates a new platform', async () => {
    listPlatformsMock.mockResolvedValue([])
    createPlatformMock.mockResolvedValue({ id: 'p1', name: 'X', url: null, authKind: 'PASSWORD' })
    renderPage()

    await userEvent.type(await screen.findByLabelText(/nome/i), 'X')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    await vi.waitFor(() => {
      expect(createPlatformMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'X', authKind: 'PASSWORD' }))
    })
  })
})
