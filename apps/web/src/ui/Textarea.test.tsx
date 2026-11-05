import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Textarea } from './Textarea'

describe('Textarea', () => {
  it('is named by its label', () => {
    render(<Textarea label="Notas" />)

    expect(screen.getByRole('textbox', { name: 'Notas' }).tagName).toBe('TEXTAREA')
  })

  it('marks, links and announces an error, as Input does', () => {
    render(<Textarea label="Notas" error="As notas são demasiado longas." />)

    const textarea = screen.getByRole('textbox', { name: 'Notas' })
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    expect(textarea).toHaveAccessibleDescription('As notas são demasiado longas.')
    expect(screen.getByRole('alert')).toHaveTextContent('As notas são demasiado longas.')
  })

  // Stage 1's rule for weight 400: it holds prose.
  it('sets prose in the regular weight and resizes vertically only', () => {
    render(<Textarea label="Notas" />)

    expect(screen.getByRole('textbox', { name: 'Notas' })).toHaveClass('font-normal', 'resize-y')
  })
})
