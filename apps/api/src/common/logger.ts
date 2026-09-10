import type { Params } from 'nestjs-pino'

/**
 * Nothing that could reconstruct a credential may reach the log. Exported so
 * a test can assert the list, because a stray debugging log is easy to add and
 * easy to forget.
 */
export const LOGGER_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.body.authHash',
  'req.body.kdfSalt',
  'req.body.ciphertext',
  'req.body.password',
  'res.headers["set-cookie"]',
] as const

export const LOGGER_OPTIONS: Params = {
  pinoHttp: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: { paths: [...LOGGER_REDACT_PATHS], censor: '[redacted]' },
    autoLogging: { ignore: (request) => request.url === '/api/v1/health' },
  },
}
