import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from './Badge'

describe('Badge', () => {
  it('renders its content', () => {
    render(<Badge tone="danger">Atrasadas</Badge>)
    expect(screen.getByText('Atrasadas')).toBeInTheDocument()
  })

  it('uses the tint-and-700-text pairing for each tone', () => {
    render(<Badge tone="warning">Esta semana</Badge>)
    const badge = screen.getByText('Esta semana')
    expect(badge.className).toContain('bg-warning-50')
    expect(badge.className).toContain('text-warning-700')
  })

  it('renders a pill when asked, and a tag by default', () => {
    const { rerender } = render(<Badge>tag</Badge>)
    expect(screen.getByText('tag').className).toContain('rounded-control')

    rerender(<Badge shape="pill">pill</Badge>)
    expect(screen.getByText('pill').className).toContain('rounded-full')
  })

  it('strikes through when asked', () => {
    render(<Badge strikethrough>Anulado</Badge>)
    expect(screen.getByText('Anulado').className).toContain('line-through')
  })
})
