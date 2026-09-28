import type { ReactElement } from 'react'
import { act } from 'react'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import { initI18n } from '../i18n'
import { formatCurrency } from '../i18n/format'
import { Money } from './Money'

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderMoney(ui: ReactElement) {
  return render(<I18nextProvider i18n={i18next}>{ui}</I18nextProvider>)
}

// `formatCurrency` separates thousands with a narrow no-break space (U+202F).
// Testing Library normalizes every whitespace run in the DOM to a plain space
// before matching, but leaves the query string alone — so the expected text
// has to be normalized the same way or it can never match.
function shown(value: string): string {
  return value.replace(/\s/g, ' ')
}

describe('Money', () => {
  it('formats through formatCurrency, never on its own', () => {
    renderMoney(<Money cents={214_500} />)
    expect(screen.getByText(shown(formatCurrency(214_500, 'pt-PT')))).toBeInTheDocument()
  })

  it('reads a negative amount as a credit', () => {
    renderMoney(<Money cents={-38_000} />)
    const amount = screen.getByText(shown(formatCurrency(-38_000, 'pt-PT')))
    expect(amount.className).toContain('text-success-700')
  })

  it('reads a positive amount as a debit', () => {
    renderMoney(<Money cents={38_000} />)
    expect(screen.getByText(shown(formatCurrency(38_000, 'pt-PT'))).className).toContain('text-ink')
  })

  // Review Focus 2. Zero is not a credit, and -0 must not print a minus.
  it('treats zero as a debit, and never renders a negative zero', () => {
    renderMoney(<Money cents={-0} />)
    const amount = screen.getByText(/0,00/)
    expect(amount.textContent?.startsWith('-')).toBe(false)
    expect(amount.className).toContain('text-ink')
  })

  it('strikes through a written-off amount whatever its sign', () => {
    renderMoney(<Money cents={9_500} tone="writtenOff" />)
    const amount = screen.getByText(shown(formatCurrency(9_500, 'pt-PT')))
    expect(amount.className).toContain('line-through')
    expect(amount.className).toContain('text-subtle')
  })

  // Phase 4's client credit is a POSITIVE balance the client may spend.
  it('lets a caller force the credit tone on a positive amount', () => {
    renderMoney(<Money cents={21_250} tone="credit" />)
    expect(screen.getByText(shown(formatCurrency(21_250, 'pt-PT'))).className).toContain('text-success-700')
  })

  // Review Focus 3. A component that reads i18n.language without
  // subscribing keeps the old locale forever.
  it('reformats when the locale changes at runtime', async () => {
    renderMoney(<Money cents={214_500} />)
    expect(screen.getByText(shown(formatCurrency(214_500, 'pt-PT')))).toBeInTheDocument()

    await act(async () => {
      await i18next.changeLanguage('en-GB')
    })

    expect(screen.getByText(shown(formatCurrency(214_500, 'en-GB')))).toBeInTheDocument()

    await act(async () => {
      await i18next.changeLanguage('pt-PT')
    })
  })
})
