import type { Request, Response } from 'express'

/**
 * A request for a route that does not exist at all is served by Express
 * before Nest's own routing (and therefore its exception filters) ever see
 * it, so `AppErrorFilter` cannot reach it. Mounted directly on the
 * underlying Express instance after `app.init()`, this becomes the very
 * last layer in the middleware stack: it only runs once every registered
 * controller route has failed to match, and it never leaves the JSON
 * envelope out of any response as Express's default 404 page would.
 */
export function notFoundFallback(_request: Request, response: Response): void {
  response.status(404).json({ error: { code: 'common.not_found', params: {} } })
}
