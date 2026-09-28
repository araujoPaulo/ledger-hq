import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('renders its label and is enabled by default', () => {
    render(<Button>Guardar</Button>)
    const button = screen.getByRole('button', { name: 'Guardar' })
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('type', 'button')
  })

  // A button that swaps its label for a spinner loses its accessible name
  // mid-action, which is exactly when a screen reader user needs it.
  it('keeps its accessible name while loading, and disables itself', () => {
    render(<Button isLoading>Guardar</Button>)
    const button = screen.getByRole('button', { name: 'Guardar' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  // Spec §6.1: an icon-only button REQUIRES an accessible name, and the type
  // is what enforces it. Stage 2's forms are the first real consumers, and an
  // unlabelled icon button is invisible to a screen reader.
  it('will not compile an icon-only button without an accessible name', () => {
    // @ts-expect-error size="icon" narrows props to require aria-label
    render(<Button size="icon">{null}</Button>)
    render(
      <Button size="icon" aria-label="Definições">
        {null}
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'Definições' })).toBeInTheDocument()
  })

  it('passes through arbitrary button props', () => {
    render(
      <Button type="submit" data-testid="submit">
        Criar
      </Button>,
    )
    expect(screen.getByTestId('submit')).toHaveAttribute('type', 'submit')
  })
})
