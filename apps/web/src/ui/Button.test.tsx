import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('renders its label and is enabled by default', () => {
    render(<Button>Guardar</Button>)
    const button = screen.getByRole('button', { name: 'Guardar' })
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('type', 'button')
  })

  // A button that swaps its label for a spinner loses its accessible name
  // mid-action, which is exactly when a screen reader user needs it.
  it('keeps its accessible name while loading, and disables itself', () => {
    render(<Button isLoading>Guardar</Button>)
    const button = screen.getByRole('button', { name: 'Guardar' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  // Spec §6.1: an icon-only button REQUIRES an accessible name, and the type
  // is what enforces it. Stage 2's forms are the first real consumers, and an
  // unlabelled icon button is invisible to a screen reader.
  it('will not compile an icon-only button without an accessible name', () => {
    // @ts-expect-error size="icon" narrows props to require aria-label
    render(<Button size="icon">{null}</Button>)
    render(
      <Button size="icon" aria-label="Definições">
        {null}
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'Definições' })).toBeInTheDocument()
  })

  it('passes through arbitrary button props', () => {
    render(
      <Button type="submit" data-testid="submit">
        Criar
      </Button>,
    )
    expect(screen.getByTestId('submit')).toHaveAttribute('type', 'submit')
  })

  // Spec §5.6: a router Link that looks like a button, without nesting a
  // <button> inside an <a> (invalid, and two tab stops).
  it('renders its child link with the button classes under asChild', () => {
    render(
      <Button asChild variant="primary">
        <a href="/clients/new">Criar</a>
      </Button>,
    )

    const link = screen.getByRole('link', { name: 'Criar' })
    expect(link).toHaveAttribute('href', '/clients/new')
    expect(link).toHaveClass('bg-accent-600')
    expect(link).not.toHaveAttribute('type')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('forwards a caller className to the child under asChild', () => {
    render(
      <Button asChild className="x">
        <a href="/">Um</a>
      </Button>,
    )
    expect(screen.getByRole('link', { name: 'Um' })).toHaveClass('x')
  })

  it('will not compile asChild with a type, a loading state or disabled', () => {
    // @ts-expect-error type="button" on an anchor is invalid
    render(<Button asChild type="button"><a href="/">Um</a></Button>)
    // @ts-expect-error a link does not load
    render(<Button asChild isLoading><a href="/">Dois</a></Button>)
    // @ts-expect-error a link that cannot be followed should not be rendered
    render(<Button asChild disabled><a href="/">Três</a></Button>)
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })
})
