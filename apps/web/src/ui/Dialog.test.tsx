import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import { initI18n } from '../i18n'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { Input } from './Input'

await initI18n()
await i18next.changeLanguage('pt-PT')

function Harness() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button>Nova cobrança</Button>
      </Dialog.Trigger>
      <Dialog.Content title="Nova cobrança avulsa" description="Uma cobrança fora da avença.">
        <form className="flex flex-col gap-4">
          <Input label="Descrição" />
          <Dialog.Footer>
            <Dialog.Close asChild>
              <Button variant="ghost">Cancelar</Button>
            </Dialog.Close>
            <Button variant="primary" type="submit">
              Criar
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog>
  )
}

function renderHarness() {
  return render(
    <I18nextProvider i18n={i18next}>
      <Harness />
    </I18nextProvider>,
  )
}

describe('Dialog', () => {
  it('is named by its title and described by its description', async () => {
    renderHarness()
    await userEvent.click(screen.getByRole('button', { name: 'Nova cobrança' }))

    const dialog = await screen.findByRole('dialog', { name: 'Nova cobrança avulsa' })
    expect(dialog).toHaveAccessibleDescription('Uma cobrança fora da avença.')
  })

  // Spec §10.2: focus moves to the first field — not to the close button,
  // which is why Close comes after the children in the DOM.
  it('moves focus to the first field when it opens', async () => {
    renderHarness()
    await userEvent.click(screen.getByRole('button', { name: 'Nova cobrança' }))

    await waitFor(() => expect(screen.getByLabelText('Descrição')).toHaveFocus())
  })

  it('closes on Escape and returns focus to its trigger', async () => {
    renderHarness()
    const trigger = screen.getByRole('button', { name: 'Nova cobrança' })
    await userEvent.click(trigger)
    await screen.findByRole('dialog')

    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('has a labelled close button that closes it', async () => {
    renderHarness()
    await userEvent.click(screen.getByRole('button', { name: 'Nova cobrança' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Fechar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes from a Dialog.Close inside the footer', async () => {
    renderHarness()
    await userEvent.click(screen.getByRole('button', { name: 'Nova cobrança' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
