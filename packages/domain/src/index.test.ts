import { describe, expect, it } from 'vitest'
import { DOMAIN_PACKAGE_NAME } from './index'

describe('domain package', () => {
  it('is wired into the workspace', () => {
    expect(DOMAIN_PACKAGE_NAME).toBe('@ledger-hq/domain')
  })
})
