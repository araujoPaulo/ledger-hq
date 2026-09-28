import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Skeleton } from './Skeleton'

describe('Skeleton', () => {
  // The loading state is announced once by the region's own aria-busy.
  // A dozen shimmering boxes must not each announce themselves.
  it('is hidden from assistive technology', () => {
    const { container } = render(<Skeleton width="4rem" height="1rem" />)
    const block = container.firstElementChild
    expect(block).toHaveAttribute('aria-hidden', 'true')
  })

  it('applies the given dimensions', () => {
    const { container } = render(<Skeleton width="4rem" height="2rem" />)
    const block = container.firstElementChild as HTMLElement
    expect(block.style.width).toBe('4rem')
    expect(block.style.height).toBe('2rem')
  })
})
