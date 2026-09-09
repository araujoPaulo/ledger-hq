# 0001 — TypeScript monorepo with NestJS

## Context

Ledger HQ is built and operated by one developer for one practice owner. Its
domain rules — fiscal profile validation, Portuguese tax-number checks,
error codes, and (from Phase 1) cryptographic key derivation — must be
identical on the server and in the browser, or the two will quietly drift.
The system is also explicitly designed to grow: three more modules (vault,
obligations, billing) are planned on top of the same client register, and
the module boundaries have to survive that growth without becoming
ad-hoc conventions nobody enforces.

## Decision

One language, TypeScript, across the API, the browser app and two shared
packages, in a single pnpm workspace built with Turborepo
(`apps/api`, `apps/web`, `packages/domain`, `packages/crypto`,
`packages/config`). `packages/domain` and `packages/crypto` exist
specifically because both `apps/api` and `apps/web` import them — a Zod
schema or a KDF parameter is written once and used on both sides.

The API is built on **NestJS**, chosen for enforced structure rather than
performance: its module system makes `clients`/`vault`/`obligations`/
`billing` boundaries a compile-time property of each module's own
`imports: []` and `exports: []` arrays, not a convention that has to be
remembered. Dependency injection also makes services trivially testable
with fakes (see `AuthService`'s tests, which fake `PrismaService` and
`ConfigService` directly rather than standing up a real database).

Rejected alternatives, and why:

- **Fastify alone**, with no framework on top. Leaves module structure to
  convention; the boundary NestJS enforces at compile time would instead
  be an unenforced code-review habit.
- **tRPC.** Couples the client tightly to the server's own procedure
  definitions and precludes ever adding a native mobile client later
  without a second API surface.
- **Hono.** Edge/serverless-oriented; irrelevant for a system that is
  deliberately self-hosted on one office machine and never touches an
  edge runtime.

## What was actually built, beyond the original assumption

The API and the web app both ship as **ESM** (`"type": "module"` in both
`package.json` files), not the CommonJS a default `nest new` scaffold
produces. Every relative import inside `apps/api/src` carries an explicit
`.js` extension on a `.ts` source file (`import { AuthModule } from
'../auth/auth.module.js'`) — required by Node's ESM resolver, not a
mistake. This interacts with NestJS's decorator metadata: a few
constructor-injected classes (`ConfigService`, `AuthService`,
`PrismaService`) need the real class imported, not a type-only import, so
that `emitDecoratorMetadata` has something concrete to point at; each such
import carries an `eslint-disable-next-line
@typescript-eslint/consistent-type-imports` explaining exactly why the
usual type-only-import lint rule is wrong at that one call site.

## Consequences

- One schema, written once in `packages/domain`, is simultaneously a
  TypeScript type, a server-side validator and a browser form validator.
  The same is true of the crypto primitives in `packages/crypto`.
- NestJS adds real boilerplate (modules, providers, decorators) and a
  learning curve, paid once, in exchange for module boundaries that are
  compile errors rather than review comments.
- ESM adds friction of its own: explicit `.js` extensions in relative
  imports, and the handful of type-import exceptions described above. Both
  are one-time costs paid by whoever adds a new module, not recurring ones.

## Revisit when

- `typescript-eslint` ships support for TypeScript 7 (it currently caps at
  `<6.1.0`); the pinned TypeScript 6.0.3 was itself chosen only because of
  that constraint, not for any TypeScript-6-specific feature.
- A second developer joins and finds NestJS's ceremony costing more than
  the enforced boundaries are worth — at that point Fastify-with-convention
  becomes a live option again.
- A native mobile client is ever seriously considered — tRPC's rejection
  above is specifically about that case.
