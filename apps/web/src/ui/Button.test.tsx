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

  it('passes through arbitrary button props', () => {
    render(
      <Button type="submit" data-testid="submit">
        Criar
      </Button>,
    )
    expect(screen.getByTestId('submit')).toHaveAttribute('type', 'submit')
  })
})
