import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Search } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { Input } from './Input'

describe('Input', () => {
  it('is named by its visible label, and the label focuses it', async () => {
    render(<Input label="Nome" />)

    const input = screen.getByRole('textbox', { name: 'Nome' })
    await userEvent.click(screen.getByText('Nome'))
    expect(input).toHaveFocus()
  })

  // Spec §9.1: a placeholder is never the label. A hidden label still is.
  it('keeps the accessible name when the label is visually hidden', () => {
    render(<Input type="search" label="Pesquisar" hideLabel placeholder="Nome ou NIF" />)

    expect(screen.getByRole('searchbox', { name: 'Pesquisar' })).toBeInTheDocument()
    expect(screen.getByText('Pesquisar')).toHaveClass('sr-only')
  })

  it('is described by its hint, then its error, in that order', () => {
    render(<Input label="NIF" hint="Nove dígitos" error="O NIF não é válido." />)

    expect(screen.getByRole('textbox', { name: 'NIF' })).toHaveAccessibleDescription(
      'Nove dígitos O NIF não é válido.',
    )
  })

  // Spec §9.2: announced, linked, marked — never colour alone.
  it('marks an error invalid and announces it', () => {
    render(<Input label="NIF" error="O NIF não é válido." />)

    expect(screen.getByRole('textbox', { name: 'NIF' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('O NIF não é válido.')
  })

  it('is neither invalid nor described without a hint or an error', () => {
    render(<Input label="Nome" />)

    const input = screen.getByRole('textbox', { name: 'Nome' })
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("appends the caller's own aria-describedby rather than replacing it", () => {
    render(
      <>
        <p id="external">Usado nas faturas</p>
        <Input label="NIF" hint="Nove dígitos" aria-describedby="external" />
      </>,
    )

    expect(screen.getByRole('textbox', { name: 'NIF' })).toHaveAccessibleDescription(
      'Nove dígitos Usado nas faturas',
    )
  })

  // Spec §11: the search box's "/" shortcut focuses through this ref. A ref
  // that lands on a wrapper silently breaks it.
  it('forwards its ref to the input element', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Input label="Nome" ref={ref} />)

    expect(ref.current).toBe(screen.getByRole('textbox', { name: 'Nome' }))
  })

  it('puts className on the input, not on a wrapper', () => {
    render(<Input label="Nome" className="h-9!" />)

    expect(screen.getByRole('textbox', { name: 'Nome' })).toHaveClass('h-9!')
  })

  it('draws a leading icon hidden from assistive technology and pads past it', () => {
    const { container } = render(<Input type="search" label="Pesquisar" leadingIcon={Search} />)

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('searchbox', { name: 'Pesquisar' })).toHaveClass('pl-9')
  })

  it('uses tabular figures for numeric input', () => {
    render(<Input label="NIF" inputMode="numeric" />)

    expect(screen.getByRole('textbox', { name: 'NIF' })).toHaveClass('tabular-nums')
  })

  it('passes native props through, including type and disabled', () => {
    render(<Input label="Desde" type="date" disabled defaultValue="2026-01-01" />)

    const input = screen.getByLabelText('Desde')
    expect(input).toHaveAttribute('type', 'date')
    expect(input).toBeDisabled()
    expect(input).toHaveValue('2026-01-01')
  })
})
