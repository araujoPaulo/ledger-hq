import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ToastProvider } from '../ui'

const { RecoveryCodeDisplay } = await import('./RecoveryCodeDisplay')

await initI18n()
await i18next.changeLanguage('pt-PT')

const CODE = 'K7QPM-3RTXA-WN5HD-2ZBEC-Y6JLF-Q'
const writeText = vi.fn()

function renderDisplay() {
  return render(
    <I18nextProvider i18n={i18next}>
      <ToastProvider>
        <RecoveryCodeDisplay code={CODE} />
      </ToastProvider>
    </I18nextProvider>,
  )
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('RecoveryCodeDisplay', () => {
  beforeEach(() => {
    writeText.mockReset()
    writeText.mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
  })

  it('renders the code as six groups, in order, in a labelled list', () => {
    renderDisplay()

    const list = screen.getByRole('list', { name: /código de recuperação/i })
    const groups = within(list).getAllByRole('listitem').map((item) => item.textContent)
    expect(groups).toEqual(['K7QPM', '3RTXA', 'WN5HD', '2ZBEC', 'Y6JLF', 'Q'])
  })

  // F2: Tailwind's preflight removes list markers, which makes WebKit drop the
  // list semantics (and the label) unless the role is explicit.
  it('keeps its list semantics explicit', () => {
    renderDisplay()
    expect(screen.getByRole('list', { name: /código de recuperação/i })).toHaveAttribute('role', 'list')
  })

  it('does not draw the hyphens — the grid is the separator', () => {
    renderDisplay()
    expect(screen.queryByText(CODE)).not.toBeInTheDocument()
  })

  it('copies the canonical hyphenated code and confirms it', async () => {
    renderDisplay()

    await userEvent.click(screen.getByRole('button', { name: /copiar código/i }))

    expect(writeText).toHaveBeenCalledWith(CODE)
    // Radix Toast also mirrors the text into a visually hidden announcer for
    // about a second, so it can be found twice: find all, not one.
    expect(await screen.findAllByText(/código copiado/i)).not.toHaveLength(0)
  })

  // Review Focus 3: no clipboard (plain HTTP) or a denied write must not
  // produce a "copied" toast.
  it('stays quiet when the clipboard refuses the write', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    renderDisplay()

    await userEvent.click(screen.getByRole('button', { name: /copiar código/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    await settle()
    expect(screen.queryAllByText(/código copiado/i)).toHaveLength(0)
    // The code is still there to copy by hand.
    expect(screen.getByRole('list', { name: /código de recuperação/i })).toBeInTheDocument()
  })

  it('stays quiet when there is no clipboard API at all', async () => {
    Object.assign(navigator, { clipboard: undefined })
    renderDisplay()

    await userEvent.click(screen.getByRole('button', { name: /copiar código/i }))

    await settle()
    expect(screen.queryAllByText(/código copiado/i)).toHaveLength(0)
  })
})
