import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
  it('toggles when its label text is clicked', async () => {
    render(<Checkbox label="Mostrar arquivados" />)

    const checkbox = screen.getByRole('checkbox', { name: 'Mostrar arquivados' })
    await userEvent.click(screen.getByText('Mostrar arquivados'))
    expect(checkbox).toBeChecked()
  })

  // The name stays the label alone; the description is the description.
  it('is described by its description, which is not part of its name', () => {
    render(<Checkbox label="Tem empregados" description="Ativa a obrigação da DMR mensal." />)

    const checkbox = screen.getByRole('checkbox', { name: 'Tem empregados' })
    expect(checkbox).toHaveAccessibleDescription('Ativa a obrigação da DMR mensal.')
  })

  // Spec §9.4: in the filter bar the whole 40px box is the touch target.
  it('draws the boxed variant as one 40px clickable box', async () => {
    render(<Checkbox boxed label="Mostrar arquivados" />)

    const box = screen.getByText('Mostrar arquivados').closest('label')
    expect(box).toHaveClass('h-10')
    await userEvent.click(box as HTMLElement)
    expect(screen.getByRole('checkbox', { name: 'Mostrar arquivados' })).toBeChecked()
  })

  it('passes native props and its ref to the input', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Checkbox label="Atividade aberta" ref={ref} disabled defaultChecked />)

    const checkbox = screen.getByRole('checkbox', { name: 'Atividade aberta' })
    expect(ref.current).toBe(checkbox)
    expect(checkbox).toBeDisabled()
    expect(checkbox).toBeChecked()
  })
})
