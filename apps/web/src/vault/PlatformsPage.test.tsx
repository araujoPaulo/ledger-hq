import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { initI18n } from '../i18n'

const listPlatformsMock = vi.hoisted(() => vi.fn())
const createPlatformMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ listPlatforms: listPlatformsMock, createPlatform: createPlatformMock }))

const { PlatformsPage } = await import('./PlatformsPage')

await initI18n()
await i18next.changeLanguage('pt-PT')

const PORTAL = { id: 'p1', name: 'Portal das Finanças', url: null, authKind: 'PASSWORD' }

function renderPage(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const rootRoute = createRootRoute()
  const platformsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/vault/platforms', component: PlatformsPage })
  const setupRoute = createRoute({ getParentRoute: () => rootRoute, path: '/vault/setup', component: () => null })
  const router = createRouter({
    routeTree: rootRoute.addChildren([platformsRoute, setupRoute]),
    history: createMemoryHistory({ initialEntries: ['/vault/platforms'] }),
  })

  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

describe('PlatformsPage', () => {
  beforeEach(() => {
    listPlatformsMock.mockReset()
    createPlatformMock.mockReset()
  })

  it('is titled Vault, with the platforms as a section beneath it', async () => {
    listPlatformsMock.mockResolvedValue([PORTAL])
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Cofre' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Plataformas' })).toBeInTheDocument()
  })

  it('lists existing platforms', async () => {
    listPlatformsMock.mockResolvedValue([PORTAL])
    renderPage()
    expect(await screen.findByText('Portal das Finanças')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    listPlatformsMock.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/ainda não há plataformas/i)).toBeInTheDocument()
  })

  it('creates a platform through the dialog, then closes it and refetches', async () => {
    listPlatformsMock.mockResolvedValue([PORTAL])
    createPlatformMock.mockResolvedValue({ id: 'p2', name: 'Banco BPI Empresas', url: null, authKind: 'PASSWORD_OTP' })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /nova plataforma/i }))
    const dialog = await screen.findByRole('dialog', { name: /nova plataforma/i })

    await userEvent.type(within(dialog).getByLabelText(/^nome$/i), 'Banco BPI Empresas')
    await userEvent.type(within(dialog).getByLabelText(/url/i), 'https://bpinet.bpi.pt')
    await userEvent.selectOptions(within(dialog).getByLabelText(/tipo de autenticação/i), 'PASSWORD_OTP')
    await userEvent.click(within(dialog).getByRole('button', { name: /criar/i }))

    await waitFor(() => {
      expect(createPlatformMock).toHaveBeenCalledWith({
        name: 'Banco BPI Empresas',
        url: 'https://bpinet.bpi.pt',
        authKind: 'PASSWORD_OTP',
      })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(listPlatformsMock).toHaveBeenCalledTimes(2)
  })

  it('sends no url when the field is left empty', async () => {
    listPlatformsMock.mockResolvedValue([PORTAL])
    createPlatformMock.mockResolvedValue({ id: 'p2', name: 'X', url: null, authKind: 'PASSWORD' })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /nova plataforma/i }))
    const dialog = await screen.findByRole('dialog', { name: /nova plataforma/i })
    await userEvent.type(within(dialog).getByLabelText(/^nome$/i), 'X')
    await userEvent.click(within(dialog).getByRole('button', { name: /criar/i }))

    await waitFor(() => {
      expect(createPlatformMock).toHaveBeenCalledWith({ name: 'X', url: undefined, authKind: 'PASSWORD' })
    })
  })

  // Review Focus 4: a failed create keeps the dialog, the typed values and
  // the server's message together.
  it('keeps the dialog open with the error and the typed name when creating fails', async () => {
    listPlatformsMock.mockResolvedValue([PORTAL])
    createPlatformMock.mockRejectedValue(new ApiError('platforms.name_taken', { name: 'Portal das Finanças' }, 409))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /nova plataforma/i }))
    const dialog = await screen.findByRole('dialog', { name: /nova plataforma/i })
    await userEvent.type(within(dialog).getByLabelText(/^nome$/i), 'Portal das Finanças')
    await userEvent.click(within(dialog).getByRole('button', { name: /criar/i }))

    expect(await within(dialog).findByText('Já existe uma plataforma com o nome Portal das Finanças.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /nova plataforma/i })).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^nome$/i)).toHaveValue('Portal das Finanças')
  })

  it('closes the dialog on Cancel without creating anything', async () => {
    listPlatformsMock.mockResolvedValue([PORTAL])
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /nova plataforma/i }))
    const dialog = await screen.findByRole('dialog', { name: /nova plataforma/i })
    await userEvent.click(within(dialog).getByRole('button', { name: /cancelar/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(createPlatformMock).not.toHaveBeenCalled()
  })

  it('shows a skeleton while loading, not a blank screen', async () => {
    // A promise that never settles: the query stays pending.
    listPlatformsMock.mockReturnValue(new Promise(() => {}))
    renderPage()

    await waitFor(() => {
      expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    })
    expect(document.querySelectorAll('[aria-hidden="true"].animate-pulse').length).toBeGreaterThan(0)
  })

  it('offers to create the first platform from the empty state', async () => {
    listPlatformsMock.mockResolvedValue([])
    renderPage()

    expect(await screen.findByText(/adiciona as plataformas/i)).toBeInTheDocument()
    // Two triggers when empty: the header's and the empty state's.
    const buttons = screen.getAllByRole('button', { name: /nova plataforma/i })
    expect(buttons).toHaveLength(2)

    await userEvent.click(buttons[1]!)
    expect(await screen.findByRole('dialog', { name: /nova plataforma/i })).toBeInTheDocument()
  })

  it('shows each platform with its URL host and authentication kind, not the full URL', async () => {
    listPlatformsMock.mockResolvedValue([
      {
        id: 'p1',
        name: 'Portal das Finanças',
        url: 'https://www.portaldasfinancas.gov.pt/at/html/index.html',
        authKind: 'PASSWORD_OTP',
      },
    ])
    renderPage()

    expect(await screen.findByText('www.portaldasfinancas.gov.pt')).toBeInTheDocument()
    expect(screen.queryByText(/index\.html/)).not.toBeInTheDocument()
    expect(screen.getByText('Palavra-passe + código de verificação')).toBeInTheDocument()
  })

  it('omits the host line for a platform with no URL', async () => {
    listPlatformsMock.mockResolvedValue([
      PORTAL,
      { id: 'p2', name: 'Segurança Social Direta', url: 'https://app.seg-social.pt/login', authKind: 'PASSWORD' },
    ])
    renderPage()

    // The name's parent holds the name and, when there is a URL, the host line.
    const withoutUrl = (await screen.findByText('Portal das Finanças')).parentElement!
    const withUrl = screen.getByText('Segurança Social Direta').parentElement!
    expect(withUrl.children).toHaveLength(2)
    expect(withoutUrl.children).toHaveLength(1)
  })

  // Review Focus 5: a URL stored without a scheme does not parse; show it as
  // stored rather than throwing or dropping it.
  it('shows a URL that does not parse exactly as stored', async () => {
    listPlatformsMock.mockResolvedValue([
      { id: 'p1', name: 'Segurança Social Direta', url: 'seg-social.pt', authKind: 'PASSWORD' },
    ])
    renderPage()

    expect(await screen.findByText('seg-social.pt')).toBeInTheDocument()
  })

  it('shows a scheme-less host:port exactly as stored', async () => {
    listPlatformsMock.mockResolvedValue([
      { id: 'p1', name: 'Servidor local', url: 'localhost:8080', authKind: 'PASSWORD' },
    ])
    renderPage()

    expect(await screen.findByText('localhost:8080')).toBeInTheDocument()
  })
})
