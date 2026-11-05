import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Tabs } from './Tabs'

function Harness() {
  const [value, setValue] = useState('overview')

  return (
    <Tabs value={value} onValueChange={setValue}>
      <Tabs.List aria-label="Cliente">
        <Tabs.Trigger value="overview">Resumo</Tabs.Trigger>
        <Tabs.Trigger value="billing">Faturação</Tabs.Trigger>
        <Tabs.Trigger value="credentials">Credenciais</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="overview">Painel de resumo</Tabs.Content>
      <Tabs.Content value="billing">Painel de faturação</Tabs.Content>
      <Tabs.Content value="credentials">Painel de credenciais</Tabs.Content>
    </Tabs>
  )
}

describe('Tabs', () => {
  // Spec §5.1: an inactive panel is unmounted, so its queries do not run.
  it('mounts only the active panel', () => {
    render(<Harness />)

    expect(screen.getByText('Painel de resumo')).toBeInTheDocument()
    expect(screen.queryByText('Painel de faturação')).not.toBeInTheDocument()
    expect(screen.queryByText('Painel de credenciais')).not.toBeInTheDocument()
  })

  it('moves between tabs with the arrow keys, and Home/End jump', async () => {
    render(<Harness />)

    await userEvent.tab()
    expect(screen.getByRole('tab', { name: 'Resumo' })).toHaveFocus()

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Faturação' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Painel de faturação')).toBeInTheDocument()
    expect(screen.queryByText('Painel de resumo')).not.toBeInTheDocument()

    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Credenciais' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Resumo' })).toHaveAttribute('aria-selected', 'true')
  })

  it('labels each panel by its tab', () => {
    render(<Harness />)

    expect(screen.getByRole('tabpanel', { name: 'Resumo' })).toHaveTextContent('Painel de resumo')
  })
})
