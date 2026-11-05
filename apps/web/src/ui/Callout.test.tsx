import { render, screen } from '@testing-library/react'
import { RefreshCw } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { Callout } from './Callout'

describe('Callout', () => {
  it('renders its title, body and action', () => {
    render(
      <Callout tone="warning" icon={RefreshCw} title="Alterações por aplicar" action={<button type="button">Aplicar</button>}>
        3 a criar, 0 a retirar
      </Callout>,
    )

    expect(screen.getByText('Alterações por aplicar')).toBeInTheDocument()
    expect(screen.getByText('3 a criar, 0 a retirar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeInTheDocument()
  })

  it('hides its icon from assistive technology', () => {
    const { container } = render(<Callout icon={RefreshCw}>Texto</Callout>)

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  // The vault gate's offline message keeps the status role it carries today.
  it('carries a live-region role only when asked to', () => {
    const { rerender } = render(<Callout>Texto</Callout>)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerender(<Callout role="status">Texto</Callout>)
    expect(screen.getByRole('status')).toHaveTextContent('Texto')
  })
})
