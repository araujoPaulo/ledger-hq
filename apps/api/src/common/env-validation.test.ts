import { describe, expect, it } from 'vitest'
import { validateEnv } from './env-validation.js'

describe('validateEnv', () => {
  it('rejects a config with no AUTH_SALT_SECRET at all', () => {
    expect(() => validateEnv({})).toThrow('AUTH_SALT_SECRET')
  })

  it('rejects an empty AUTH_SALT_SECRET', () => {
    expect(() => validateEnv({ AUTH_SALT_SECRET: '' })).toThrow('AUTH_SALT_SECRET')
  })

  it('rejects a non-string AUTH_SALT_SECRET', () => {
    expect(() => validateEnv({ AUTH_SALT_SECRET: 12345 })).toThrow('AUTH_SALT_SECRET')
  })

  it('passes a config with AUTH_SALT_SECRET set through unchanged', () => {
    const config = { AUTH_SALT_SECRET: 'a-real-secret', OTHER_VAR: '1' }

    expect(validateEnv(config)).toEqual(config)
  })
})
