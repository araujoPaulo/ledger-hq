import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataList } from './DataList'

describe('DataList', () => {
  it('renders both slots of a row', () => {
    render(
      <DataList>
        <DataList.Row label={<span>Nordeste Têxteis</span>} value={<span>6450,00 €</span>} />
      </DataList>,
    )
    expect(screen.getByText('Nordeste Têxteis')).toBeInTheDocument()
    expect(screen.getByText('6450,00 €')).toBeInTheDocument()
  })

  it('renders an interactive label, so a row can be a navigation target', () => {
    render(
      <DataList>
        <DataList.Row label={<a href="/clients/c1">Padaria Manso</a>} value={<span>3180,00 €</span>} />
      </DataList>,
    )
    expect(screen.getByRole('link', { name: 'Padaria Manso' })).toHaveAttribute('href', '/clients/c1')
  })

  it('marks the total apart from an ordinary row', () => {
    render(
      <DataList>
        <DataList.Row label={<span>Uma linha</span>} value={<span>1,00 €</span>} />
        <DataList.Total label="Total" value={<span>1,00 €</span>} />
      </DataList>,
    )
    const total = screen.getByText('Total')
    expect(total.className).toContain('font-semibold')
  })
})
