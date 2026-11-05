import { describe, expect, it } from 'vitest'
import { CLIENT_TABS, isClientTab, validateClientSearch } from './clientTabs'

describe('validateClientSearch', () => {
  it('keeps a known tab', () => {
    for (const tab of CLIENT_TABS) expect(validateClientSearch({ tab })).toEqual({ tab })
  })

  // Review Focus 2: an old bookmark or a typo lands on Overview.
  it('drops an unknown, empty or non-string tab', () => {
    expect(validateClientSearch({ tab: 'faturas' })).toEqual({})
    expect(validateClientSearch({ tab: '' })).toEqual({})
    expect(validateClientSearch({ tab: 3 })).toEqual({})
    expect(validateClientSearch({})).toEqual({})
  })

  it('ignores other search params', () => {
    expect(validateClientSearch({ tab: 'billing', q: 'x' })).toEqual({ tab: 'billing' })
  })
})

describe('isClientTab', () => {
  it('accepts exactly the five tabs', () => {
    expect(CLIENT_TABS.filter(isClientTab)).toHaveLength(5)
    expect(isClientTab('Overview')).toBe(false)
    expect(isClientTab(undefined)).toBe(false)
  })
})
