import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ApiError } from '../api/client'
import { Dialog } from '../ui'

const getFiscalProfile = vi.hoisted(() => vi.fn())
const putFiscalProfile = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getFiscalProfile, putFiscalProfile }))

const { FiscalProfileForm } = await import('./FiscalProfileForm')
const { FiscalProfileCard } = await import('./FiscalProfileCard')

await initI18n()
// Same pin as the other clients/* tests: jsdom reports navigator.language
// as "en-US", overriding the pt-PT fallback these assertions rely on.
await i18next.changeLanguage('pt-PT')

function wrap(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>{children}</I18nextProvider>
    </QueryClientProvider>
  )
}

// The form's footer is a Dialog.Footer with a Dialog.Close, so it only ever
// renders inside a dialog — the tests put it in one.
function renderForm(kind: 'COMPANY' | 'INDIVIDUAL') {
  const onSaved = vi.fn()
  render(
    wrap(
      <Dialog open>
        <Dialog.Content title="Perfil fiscal">
          <FiscalProfileForm clientId="1" kind={kind} initial={null} onSaved={onSaved} />
        </Dialog.Content>
      </Dialog>,
    ),
  )
  return { onSaved }
}

const profile = {
  clientId: '1',
  updatedAt: '2026-09-01T10:00:00.000Z',
  hasOpenActivity: true,
  vatRegime: 'MONTHLY',
  incomeTax: 'CIT',
  hasEmployees: true,
  hasWithholding: false,
  isVatCashBasis: false,
  startedAt: '2024-01-01',
}

beforeEach(() => {
  getFiscalProfile.mockReset()
  putFiscalProfile.mockReset()
})

describe('FiscalProfileForm', () => {
  it('hides hasEmployees entirely for an individual', () => {
    renderForm('INDIVIDUAL')
    expect(screen.queryByLabelText(/tem empregados/i)).not.toBeInTheDocument()
  })

  // Disabled is right here: it applies, and cannot change (spec §7.1).
  it('forces hasOpenActivity on and read-only for a company, and says why', () => {
    renderForm('COMPANY')
    const openActivity = screen.getByRole('checkbox', { name: /atividade aberta/i })
    expect(openActivity).toBeChecked()
    expect(openActivity).toBeDisabled()
    expect(openActivity).toHaveAccessibleDescription(/uma empresa tem sempre atividade aberta/i)
    expect(screen.getByLabelText(/tem empregados/i)).toBeInTheDocument()
  })

  it('shows a live violation in a callout and disables submit, without calling the API', async () => {
    renderForm('INDIVIDUAL')

    const saveButton = screen.getByRole('button', { name: /^guardar$/i })
    expect(saveButton).toBeEnabled()

    await userEvent.selectOptions(screen.getByLabelText(/imposto sobre o rendimento/i), 'CIT')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /imposto sobre o rendimento não corresponde ao tipo de cliente/i,
    )
    expect(saveButton).toBeDisabled()

    await userEvent.click(saveButton)
    expect(putFiscalProfile).not.toHaveBeenCalled()
  })

  it('saves once the violation is cleared, then reports it saved', async () => {
    putFiscalProfile.mockResolvedValue({})
    const { onSaved } = renderForm('INDIVIDUAL')

    await userEvent.selectOptions(screen.getByLabelText(/imposto sobre o rendimento/i), 'CIT')
    await userEvent.selectOptions(screen.getByLabelText(/imposto sobre o rendimento/i), 'PIT_CATEGORY_B')
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    await vi.waitFor(() => {
      expect(putFiscalProfile).toHaveBeenCalledWith('1', expect.objectContaining({ incomeTax: 'PIT_CATEGORY_B' }))
    })
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })
})

describe('FiscalProfileCard', () => {
  function renderCard(kind: 'COMPANY' | 'INDIVIDUAL' = 'COMPANY') {
    render(wrap(<FiscalProfileCard clientId="1" kind={kind} />))
  }

  it('reads a loaded profile, with a badge for each flag that is on and none for those off', async () => {
    getFiscalProfile.mockResolvedValue(profile)
    renderCard()

    expect(await screen.findByText('Mensal')).toBeInTheDocument()
    expect(screen.getByText('IRC')).toBeInTheDocument()
    expect(screen.getByText('01/01/2024')).toBeInTheDocument()
    expect(screen.getByText('Atividade aberta')).toBeInTheDocument()
    expect(screen.getByText('Tem empregados')).toBeInTheDocument()
    expect(screen.queryByText('Faz retenções na fonte')).not.toBeInTheDocument()
  })

  it('opens the form, filled from the profile, from the Edit button', async () => {
    getFiscalProfile.mockResolvedValue(profile)
    renderCard()

    await userEvent.click(await screen.findByRole('button', { name: /^editar$/i }))

    const dialog = await screen.findByRole('dialog', { name: 'Perfil fiscal' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByLabelText(/regime de iva/i)).toHaveValue('MONTHLY')
  })

  it('offers to set up a missing profile, with the kind defaults', async () => {
    getFiscalProfile.mockRejectedValue(new ApiError('common.not_found', {}, 404))
    renderCard('COMPANY')

    expect(await screen.findByText(/ainda não há perfil fiscal/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^preencher$/i }))

    expect(await screen.findByRole('checkbox', { name: /atividade aberta/i })).toBeChecked()
  })

  // The guard against overwriting a profile that merely failed to load.
  it('shows the error and offers no form when the profile fails to load', async () => {
    getFiscalProfile.mockRejectedValue(new ApiError('common.internal_error', {}, 500))
    renderCard()

    expect(await screen.findByText(/ocorreu um erro no servidor/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^editar$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^preencher$/i })).not.toBeInTheDocument()
  })

  it('closes the dialog once the profile is saved', async () => {
    getFiscalProfile.mockResolvedValue(profile)
    putFiscalProfile.mockResolvedValue(profile)
    renderCard()

    await userEvent.click(await screen.findByRole('button', { name: /^editar$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^guardar$/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // Review Focus 5: a failed save keeps the dialog open, the typed values and
  // shows the server's message inside it.
  it('keeps the dialog open, the typed values and the server message when the save fails', async () => {
    getFiscalProfile.mockResolvedValue(profile)
    putFiscalProfile.mockRejectedValue(new ApiError('common.internal_error', {}, 500))
    renderCard()

    await userEvent.click(await screen.findByRole('button', { name: /^editar$/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Perfil fiscal' })
    await userEvent.selectOptions(within(dialog).getByLabelText(/regime de iva/i), 'QUARTERLY')
    await userEvent.click(within(dialog).getByRole('button', { name: /^guardar$/i }))

    expect(await within(dialog).findByText(/ocorreu um erro no servidor/i)).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Perfil fiscal' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/regime de iva/i)).toHaveValue('QUARTERLY')
  })
})
