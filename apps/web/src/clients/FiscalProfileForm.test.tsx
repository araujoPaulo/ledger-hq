import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const putFiscalProfile = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ putFiscalProfile }))

const { FiscalProfileForm } = await import('./FiscalProfileForm')

await initI18n()
// Same pin as the other clients/* tests: jsdom reports navigator.language
// as "en-US", overriding the pt-PT fallback these assertions rely on.
await i18next.changeLanguage('pt-PT')

// Not part of the brief's own file list, but the self-review checklist for
// this task calls out the live-consistency behaviour by name, and nothing
// else in this task exercises it. Kept minimal: one happy path per kind's
// distinguishing rule, not a full enumeration of every violation.
function renderForm(kind: 'COMPANY' | 'INDIVIDUAL') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <FiscalProfileForm clientId="1" kind={kind} initial={null} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('FiscalProfileForm', () => {
  it('hides hasEmployees entirely for an individual', () => {
    renderForm('INDIVIDUAL')
    expect(screen.queryByLabelText(/tem empregados/i)).not.toBeInTheDocument()
  })

  it('forces hasOpenActivity to true and read-only for a company, and shows hasEmployees', () => {
    renderForm('COMPANY')
    const openActivity = screen.getByLabelText(/atividade aberta/i)
    expect(openActivity).toBeChecked()
    expect(openActivity).toBeDisabled()
    expect(screen.getByLabelText(/tem empregados/i)).toBeInTheDocument()
  })

  it('surfaces a live violation and disables submit, without calling the API', async () => {
    renderForm('INDIVIDUAL')

    const saveButton = screen.getByRole('button', { name: /guardar/i })
    expect(saveButton).not.toBeDisabled()

    await userEvent.selectOptions(screen.getByLabelText(/imposto sobre o rendimento/i), 'CIT')

    expect(
      await screen.findByText(/imposto sobre o rendimento não corresponde ao tipo de cliente/i),
    ).toBeInTheDocument()
    expect(saveButton).toBeDisabled()

    await userEvent.click(saveButton)
    expect(putFiscalProfile).not.toHaveBeenCalled()
  })

  it('re-enables submit and calls the API once the violation is cleared', async () => {
    putFiscalProfile.mockResolvedValue({})
    renderForm('INDIVIDUAL')

    await userEvent.selectOptions(screen.getByLabelText(/imposto sobre o rendimento/i), 'CIT')
    await userEvent.selectOptions(screen.getByLabelText(/imposto sobre o rendimento/i), 'PIT_CATEGORY_B')

    const saveButton = screen.getByRole('button', { name: /guardar/i })
    expect(saveButton).not.toBeDisabled()

    await userEvent.click(saveButton)

    await vi.waitFor(() => {
      expect(putFiscalProfile).toHaveBeenCalledWith('1', expect.objectContaining({ incomeTax: 'PIT_CATEGORY_B' }))
    })
  })
})
