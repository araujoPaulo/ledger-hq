import { render, screen } from '@testing-library/react'
import { CircleCheck } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders the title and the description', () => {
    render(
      <EmptyState
        icon={CircleCheck}
        title="Sem obrigações pendentes."
        description="Aparecem aqui mais tarde."
      />,
    )
    expect(screen.getByText('Sem obrigações pendentes.')).toBeInTheDocument()
    expect(screen.getByText('Aparecem aqui mais tarde.')).toBeInTheDocument()
  })

  it('renders no action when none is given', () => {
    render(<EmptyState icon={CircleCheck} title="Sem obrigações pendentes." />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders the action when given', () => {
    render(
      <EmptyState icon={CircleCheck} title="Sem clientes." action={<button type="button">Criar</button>} />,
    )
    expect(screen.getByRole('button', { name: 'Criar' })).toBeInTheDocument()
  })
})
