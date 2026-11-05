import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlatformAvatar, platformInitials } from './PlatformAvatar'

describe('platformInitials', () => {
  it('takes the first and last words', () => {
    expect(platformInitials('Portal das Finanças')).toBe('PF')
    expect(platformInitials('Segurança Social Direta')).toBe('SD')
  })

  it('takes two letters of a single word', () => {
    expect(platformInitials('bpinet')).toBe('BP')
  })

  it('copes with stray whitespace and an empty name', () => {
    expect(platformInitials('  Portal   Empresa ')).toBe('PE')
    expect(platformInitials('')).toBe('')
  })
})

describe('PlatformAvatar', () => {
  // The name is printed beside it; the initials would only repeat it.
  it('is hidden from assistive technology', () => {
    const { container } = render(<PlatformAvatar name="Portal das Finanças" />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(container).toHaveTextContent('PF')
  })
})
