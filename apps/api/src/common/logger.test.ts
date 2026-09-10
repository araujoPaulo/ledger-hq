import { describe, expect, it } from 'vitest'
import { LOGGER_REDACT_PATHS } from './logger.js'

describe('logger redaction', () => {
  it.each([
    'req.headers.cookie',
    'req.headers.authorization',
    'req.body.authHash',
    'req.body.kdfSalt',
    'req.body.ciphertext',
    'res.headers["set-cookie"]',
  ])('redacts %s', (path) => {
    expect(LOGGER_REDACT_PATHS).toContain(path)
  })
})
