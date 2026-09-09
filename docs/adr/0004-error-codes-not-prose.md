# 0004 — The API returns error codes, never prose

## Context

Ledger HQ is bilingual (`pt-PT` default, `en-GB`), and the frontend, not the
server, owns every user-facing string (design spec, section 10). If the API
ever returned a human-readable message, one of two problems would follow:
either the server would need to know the caller's locale — coupling a
backend concern to a presentation one — or the same logical error would
read differently depending on whether it was raised by server-side
validation or by the browser's own client-side check of the same rule,
because the two would be maintaining separate strings for the same
condition.

## Decision

The API never returns prose. Every response body for an error is
`{ "error": { "code": ErrorCode, "params": Record<string, unknown> } }`.
`ErrorCode` is a closed union exported from `packages/domain/src/errors.ts`
— at the time of writing, 20 members across `common.*`, `auth.*`,
`clients.*`, `fiscal_profile.*` and `employment.*` — and `AppError`
(`extends Error`, carries `code`, `params`, `status`) is the one exception
type application code throws to produce one of these responses. The
frontend, and only the frontend, turns a code into translated text.

This was extended past `AppError` itself during Phase 0, beyond what the
original scope described: `AppErrorFilter`, installed as a global
`@Catch()` filter in `apps/api/src/main.ts`, reduces *every* exception the
Nest pipeline can throw — not just `AppError` — to the same envelope. Left
alone, Nest's default handling renders its own prose `message` field for
things like a malformed JSON body or a `ForbiddenException` thrown by
`CsrfGuard` — exactly the prose leak this decision exists to prevent, just
arriving through the framework instead of application code. The filter
maps a `403` to `common.forbidden`, any other `HttpException` status to
`common.validation_failed`, and anything else — a genuine unexpected fault,
or a non-`HttpException` — to `common.internal_error` at `500`, while
still logging the real exception (message and stack) at `error` level, so
an operator debugging a live failure is not left with nothing but a status
code. A request to a route that matches no controller at all is served by
Express before Nest's own exception zone ever sees it, so a separate
fallback (`notFoundFallback`, mounted directly on the Express instance
after `app.init()`) keeps that case in the same envelope too.

The same discipline extends to Zod: schemas in `packages/domain` use a
custom error map that produces codes, not sentences, so one schema
validates identically — and reports identically — on both the server and
in a browser form.

**The browser needs its own, slightly larger, error-code type.** Failure
modes exist in the browser that the server can never produce: `fetch`
itself can throw with no response at all (the device is offline), or a
response can arrive with a body that doesn't match the envelope shape at
all. `apps/web/src/api/client.ts` therefore defines
`ClientErrorCode = ErrorCode | 'common.offline' | 'common.unexpected'`
— a distinct type from the server's own `ErrorCode`, deliberately not
folded into it, because `ErrorCode` is a claim about what the *server* can
return and adding browser-only failure modes to it would make that claim
false.

## Consequences

- Adding a new error condition means adding one string to the
  `ERROR_CODES` array and one translation key in each locale bundle — never
  editing a message inline at the call site.
- A test (part of the i18n quality gates, `pnpm --filter @ledger-hq/web
  i18n:check`) walks the locale bundles and fails if a key used by one
  locale is missing from the other, so an error code added without its
  translation breaks CI rather than shipping a raw code to a user.
- Debugging a production issue from logs alone requires reading the
  `AppErrorFilter`'s server-side log line (message + stack), not the
  response body — the response body is deliberately opaque by design.

## Revisit when

- A caller other than this one browser app ever consumes the API (a future
  native client, an admin script) and needs more structured error detail
  than a code plus flat params — at that point `params`'s shape may need
  its own schema per code, rather than an untyped
  `Record<string, unknown>`.
- The number of `ErrorCode` members grows large enough that a flat array
  stops being readable and warrants splitting into per-domain files (it is
  20 entries in one file today; comfortable, not yet a problem).
