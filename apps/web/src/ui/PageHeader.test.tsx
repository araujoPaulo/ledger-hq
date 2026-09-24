import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from './PageHeader'

describe('PageHeader', () => {
  it('renders the title as the page heading', () => {
    render(<PageHeader title="Resumo" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Resumo' })).toBeInTheDocument()
  })

  it('renders the description and the actions when given', () => {
    render(
      <PageHeader
        title="Resumo"
        description="quinta-feira"
        actions={<button type="button">Criar</button>}
      />,
    )
    expect(screen.getByText('quinta-feira')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Criar' })).toBeInTheDocument()
  })

  it('renders no description element when none is given', () => {
    render(<PageHeader title="Resumo" />)
    expect(screen.queryByRole('paragraph')).not.toBeInTheDocument()
  })
})
