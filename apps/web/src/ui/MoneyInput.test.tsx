import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { MoneyInput } from './MoneyInput'

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderInput(props: { defaultCents?: number | null } = {}) {
  const onValueChange = vi.fn()
  render(
    <I18nextProvider i18n={i18next}>
      <MoneyInput label="Valor" onValueChange={onValueChange} {...props} />
    </I18nextProvider>,
  )
  return { onValueChange, input: screen.getByRole('textbox', { name: 'Valor' }) }
}

/** Intl groups pt-PT amounts with a narrow no-break space. */
function shown(value: string): string {
  return value.replace(/\s/g, ' ')
}

afterEach(async () => {
  await i18next.changeLanguage('pt-PT')
})

describe('MoneyInput', () => {
  it('emits cents while typing euros', async () => {
    const { onValueChange, input } = renderInput()

    await userEvent.type(input, '2150,5')

    expect(onValueChange).toHaveBeenLastCalledWith(215050)
  })

  it('emits null for text that is not an amount', async () => {
    const { onValueChange, input } = renderInput()

    await userEvent.type(input, '12abc')

    expect(onValueChange).toHaveBeenLastCalledWith(null)
  })

  // Review Focus 1.
  it('treats a dot typed as a decimal mark in pt-PT as not an amount', async () => {
    const { onValueChange, input } = renderInput()

    await userEvent.type(input, '2150.50')
    await userEvent.tab()

    expect(onValueChange).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('alert')).toHaveTextContent('Indica um valor como 2150,00.')
  })

  // Spec §10.5: announced only on blur, never mid-typing.
  it('shows the format error only after blur, and hides it again while typing', async () => {
    const { input } = renderInput()

    await userEvent.type(input, '12,345')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await userEvent.tab()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')

    await userEvent.type(input, '{Backspace}')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('rewrites a valid amount in the grouped form on blur', async () => {
    const { input } = renderInput()

    await userEvent.type(input, '2150')
    await userEvent.tab()

    expect(shown((input as HTMLInputElement).value)).toBe('2 150,00')
  })

  // Review Focus 3: the blur rewrite is not a change of value.
  it('does not report a value on blur', async () => {
    const { onValueChange, input } = renderInput()

    await userEvent.type(input, '90')
    const callsBeforeBlur = onValueChange.mock.calls.length
    await userEvent.tab()

    expect(onValueChange).toHaveBeenCalledTimes(callsBeforeBlur)
  })

  it('pre-fills defaultCents in the active locale', async () => {
    renderInput({ defaultCents: 215000 })
    expect(shown((screen.getByRole('textbox', { name: 'Valor' }) as HTMLInputElement).value)).toBe('2 150,00')
  })

  it('pre-fills in en-GB notation when that is the active locale', async () => {
    await i18next.changeLanguage('en-GB')
    renderInput({ defaultCents: 215000 })

    expect(screen.getByRole('textbox', { name: 'Valor' })).toHaveValue('2,150.00')
  })

  it('asks the phone for a decimal keypad and draws the euro sign', () => {
    const { input } = renderInput()

    expect(input).toHaveAttribute('inputmode', 'decimal')
    expect(input).toHaveClass('pl-9')
    expect(input).toHaveClass('tabular-nums')
  })
})
