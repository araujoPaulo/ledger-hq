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

  it('truncates a label by default, and wraps it with wrapLabel or wrap', () => {
    render(
      <DataList>
        <DataList.Row label="plain" value="1" />
        <DataList.Row label="wrapLabel" value="2" wrapLabel />
        <DataList.Row label="wrap" value="3" wrap />
      </DataList>,
    )
    expect(screen.getByText('plain')).toHaveClass('truncate')
    expect(screen.getByText('wrapLabel')).toHaveClass('break-words')
    expect(screen.getByText('wrapLabel').className).not.toContain('truncate')
    expect(screen.getByText('wrap')).toHaveClass('break-words', 'basis-full', 'sm:basis-0')
    expect(screen.getByText('wrap').parentElement).toHaveClass('flex-wrap')
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

  // Spec §5.6: genuine name/value descriptions read as a description list.
  it('renders term and definition pairs as a dl', () => {
    const { container } = render(
      <DataList as="dl">
        <DataList.Row label="NIF" value="501442600" />
        <DataList.Row label="Contabilidade" value="Organizada" />
      </DataList>,
    )

    const list = container.querySelector('dl')
    expect(list).not.toBeNull()
    expect(list?.querySelectorAll(':scope > div > dt')).toHaveLength(2)
    expect(list?.querySelectorAll(':scope > div > dd')).toHaveLength(2)
    expect(screen.getByText('NIF').tagName).toBe('DT')
    expect(screen.getByText('NIF')).toHaveClass('text-muted')
    expect(screen.getByText('501442600').tagName).toBe('DD')
  })

  it('stays a plain div list by default', () => {
    const { container } = render(
      <DataList>
        <DataList.Row label="Uma linha" value="1,00 €" />
      </DataList>,
    )

    expect(container.querySelector('dl')).toBeNull()
    expect(container.querySelector('dt')).toBeNull()
  })
})
