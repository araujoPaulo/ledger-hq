import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Select } from './Select'

function KindOptions() {
  return (
    <>
      <option value="COMPANY">Empresa</option>
      <option value="INDIVIDUAL">Pessoa singular</option>
    </>
  )
}

describe('Select', () => {
  it('renders its option children as a native select named by its label', async () => {
    render(
      <Select label="Tipo" defaultValue="COMPANY">
        <KindOptions />
      </Select>,
    )

    const select = screen.getByRole('combobox', { name: 'Tipo' })
    expect(select.tagName).toBe('SELECT')
    expect(screen.getAllByRole('option')).toHaveLength(2)

    await userEvent.selectOptions(select, 'INDIVIDUAL')
    expect(select).toHaveValue('INDIVIDUAL')
  })

  it('keeps the label association with the label beside it (inline)', () => {
    render(
      <Select layout="inline" label="Tipo">
        <KindOptions />
      </Select>,
    )

    expect(screen.getByRole('combobox', { name: 'Tipo' })).toBeInTheDocument()
  })

  it('marks, links and announces an error, as Input does', () => {
    render(
      <Select label="Forma jurídica" error="Escolhe uma forma jurídica válida.">
        <KindOptions />
      </Select>,
    )

    const select = screen.getByRole('combobox', { name: 'Forma jurídica' })
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveAccessibleDescription('Escolhe uma forma jurídica válida.')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  // The edit form's kind: disabled because it cannot change, and the hint says so.
  it('can be disabled with a hint that explains why', () => {
    render(
      <Select label="Tipo" disabled hint="O tipo de cliente não pode ser alterado depois de criado.">
        <KindOptions />
      </Select>,
    )

    const select = screen.getByRole('combobox', { name: 'Tipo' })
    expect(select).toBeDisabled()
    expect(select).toHaveAccessibleDescription('O tipo de cliente não pode ser alterado depois de criado.')
  })

  // Spec §5.4: a filter has neither a hint nor an error.
  it('will not compile an inline select with a hint or an error', () => {
    // @ts-expect-error inline selects take no error
    render(<Select layout="inline" label="A" error="x"><KindOptions /></Select>)
    // @ts-expect-error inline selects take no hint
    render(<Select layout="inline" label="B" hint="x"><KindOptions /></Select>)
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
  })
})
