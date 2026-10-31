import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { afterEach, describe, expect, it } from 'vitest'
import { initI18n } from '../i18n'
import { LanguageMenu } from './LanguageMenu'

await initI18n()
// See LoginPage.test.tsx: jsdom reports "en-US" regardless of the host.
await i18next.changeLanguage('pt-PT')

function renderMenu() {
  return render(
    <I18nextProvider i18n={i18next}>
      <LanguageMenu />
    </I18nextProvider>,
  )
}

describe('LanguageMenu', () => {
  afterEach(async () => {
    await i18next.changeLanguage('pt-PT')
  })

  it('is an icon button named for the language', () => {
    renderMenu()

    expect(screen.getByRole('button', { name: 'Idioma' })).toBeInTheDocument()
  })

  it('lists both languages with the active one checked', async () => {
    renderMenu()

    await userEvent.click(screen.getByRole('button', { name: 'Idioma' }))

    expect(await screen.findByRole('menuitemradio', { name: 'Português' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'false')
  })

  it('switches the locale', async () => {
    renderMenu()

    await userEvent.click(screen.getByRole('button', { name: 'Idioma' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'English' }))

    await waitFor(() => expect(i18next.language).toBe('en-GB'))
    expect(document.documentElement.lang).toBe('en-GB')
  })
})
