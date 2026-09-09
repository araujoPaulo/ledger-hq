# Architecture

This describes the system as it is built at the end of Phase 0, not the
full system envisioned in the
[design specification](superpowers/specs/2026-09-04-ledger-hq-design.md).
Where the two differ, this document says so explicitly.

## Repository shape

A pnpm workspace with two applications and three shared packages, built and
tested through Turborepo (`turbo.json`: `build` and `typecheck` depend on
`^build`, so a shared package compiles to `dist/` before anything that
imports it does).

```
apps/api          NestJS, ESM, Prisma 7 + PostgreSQL
apps/web          React + Vite, installable PWA
packages/domain    Zod schemas, error codes, enums, PT identifier checks
packages/crypto    Argon2id / HKDF key-derivation primitives
packages/config    shared tsconfig / ESLint / Prettier
docker/            Dockerfiles, Caddyfile, backup script
```

`domain` and `crypto` are packages rather than modules inside `apps/api`
because both run on the server *and* in the browser: `apps/web` imports
`@ledger-hq/domain` directly for its Zod schemas and error-code type, and
`@ledger-hq/crypto` for the client-side key derivation used at bootstrap and
login. Each validation rule and each cryptographic primitive is written
once and consumed from both sides — a Zod schema in `packages/domain`
becomes the API's request validator (via a hand-rolled `ZodValidationPipe`,
not `nestjs-zod`) and the browser form's validator in the same place.

## Backend modules — as built

`apps/api/src/app.module.ts` imports seven modules. This is a finer split
than the six-module table in the design spec's section 5.2 (which groups
`clients`, `vault`, `obligations`, `billing` and `reporting` at that
granularity): the profile and employment logic that spec table folds into
`clients` are their own modules here, and `audit` and `system` are separate
too. Real dependency graph, read from each module's `imports: []`:

| Module | Responsibility | Imports |
|---|---|---|
| `health` | Liveness probe (`GET /api/v1/health`) | — |
| `auth` | Bootstrap, login, session cookie, session guard, CSRF guard | — (owns its own `PrismaService`) |
| `audit` | Appends `AuditEvent` rows | — |
| `clients` | Client CRUD, archiving | `auth` |
| `fiscal-profiles` | Per-client fiscal profile upsert | `auth`, `audit`, `clients` |
| `employments` | Employment spells between clients | `auth`, `clients` |
| `system` | `GET /api/v1/system/health-report` (backup status) | `auth` |

Not yet built: `vault` (credential storage), `obligations` (the fiscal
catalog and deadline engine), `billing` (retainers, charges, payments) and
`reporting` (cross-module read models). The rule the spec states for these
already holds for the modules that do exist, and must keep holding as the
rest are added: **`clients` is the core; `vault`, `obligations` and
`billing` never import from one another.** A view that needs data from two
of them belongs in `reporting`, never as a lateral import between two
sibling modules. Nothing in the code today violates this — there is nothing
yet that could — but it is the constraint every future module must respect.

Each module exposes a typed service and owns its own Prisma-backed
persistence; no module reaches into another module's Prisma models
directly (`fiscal-profiles` and `employments` both depend on `clients`
through `ClientsService`, not through `Client` rows they query themselves).

## API conventions

- **Prefix:** every route is mounted under `/api/v1` (`app.setGlobalPrefix('api/v1')`
  in `apps/api/src/main.ts`).
- **Validation:** request bodies and queries are validated with Zod schemas
  from `packages/domain/src/schemas/*`, via `ZodValidationPipe`. The same
  schemas are imported by `apps/web` for client-side form validation, so the
  two never drift.
- **Errors are codes, not prose.** Every error the API can return is a
  member of the `ErrorCode` union in `packages/domain/src/errors.ts` — at
  the time of writing: `common.validation_failed`, `common.not_found`,
  `common.forbidden`, `common.internal_error`, four `auth.*` codes, three
  `clients.*` codes, four `fiscal_profile.*` codes and five `employment.*`
  codes (20 in total). A response body is always `{ "error": { "code": "...", "params": {} } }`;
  the frontend, never the server, turns a code into human-readable text.
  This is enforced past `AppError` itself: `AppErrorFilter` (`@Catch()`,
  installed as a global filter) reduces *every* exception Nest's pipeline
  can throw — a body-parser failure, a `ForbiddenException` from
  `CsrfGuard`, anything uncaught — to the same code-only envelope, so a
  framework-level failure can never leak Nest's own prose `message` field.
  A request to a route that matches no controller at all is served by
  Express before Nest's filters ever see it; `notFoundFallback`, mounted
  directly on the Express instance after `app.init()`, is the fallback that
  keeps *that* case in the same envelope too.
- **The browser adds two more codes of its own.** `apps/web/src/api/client.ts`
  defines `ClientErrorCode = ErrorCode | 'common.offline' | 'common.unexpected'`
  — `common.offline` when `fetch` itself throws (no response at all) and
  `common.unexpected` when a response arrives but carries no recognisable
  `error.code`. This is a distinct type from the server's `ErrorCode`, by
  design: the browser can fail in ways the server never does, and folding
  those into the server's own union would make `ErrorCode` claim the server
  can return something it cannot.
- **Sessions**, not tokens in the request body: `auth.login` /
  `auth.bootstrap` set an `httpOnly`, `SameSite=Strict` cookie
  (`lhq_session`); `SessionGuard` resolves it against a hashed token stored
  in `Session.tokenHash`. See `docs/security-model.md` for the derivation
  that produces the credential the cookie flow is built on.
- **CSRF:** `SameSite=Strict` already stops the cookie from being sent
  cross-site; `CsrfGuard` is the second lock, rejecting any non-safe method
  (`POST`/`PUT`/`PATCH`/`DELETE`) that doesn't carry
  `X-Requested-With: ledger-hq` — a header a cross-origin form post cannot
  set.

## Technology choices that differ from a plain NestJS/Prisma tutorial

- **ESM throughout, not CommonJS.** `apps/api/package.json` and
  `apps/web/package.json` both declare `"type": "module"`. Every relative
  import inside `apps/api/src` uses an explicit `.js` extension even though
  the files are `.ts` (e.g. `import { AuthModule } from '../auth/auth.module.js'`)
  — required for Node's ESM resolver, not a typo. A few constructor-injected
  classes (`ConfigService`, `AuthService`, `PrismaService`) carry an
  `eslint-disable-next-line @typescript-eslint/consistent-type-imports` with
  a comment explaining why: `emitDecoratorMetadata` needs the real class
  reference at the injection site, not a type-only import, so the usual
  "type-only import" lint rule is deliberately overridden at exactly those
  call sites.
- **Prisma 7's driver-adapter wiring.** The schema's `datasource` block
  carries no `url` — Prisma 7 forbids it there. `apps/api/prisma.config.ts`
  reads `DATABASE_URL` via `env()` for the CLI (`migrate`, `generate`), and
  `PrismaService` (`apps/api/src/common/prisma.service.ts`) constructs
  `PrismaClient` with `new PrismaPg({ connectionString: process.env.DATABASE_URL })`
  from `@prisma/adapter-pg` at runtime — the connection string is read in
  exactly one place. The generator also writes the generated client into
  `apps/api/src/generated/prisma` (into the source tree, not
  `node_modules`), which is why that path is `.gitignore`d rather than
  committed.
- **The generated Prisma client is source-tree-local**, so `pnpm install`
  cannot skip running it: `apps/api/package.json`'s `postinstall` script
  runs `prisma generate` (defaulting `DATABASE_URL` to a local placeholder
  if unset — code generation does not need a reachable database).

## Data model

Postgres, via Prisma. `Client` is the aggregate everything else attaches
to:

```
                         ┌───────────────┐
                         │    Client     │   kind: COMPANY | INDIVIDUAL
                         │ (id, kind)    │   @@unique([id, kind]) — the
                         └───────┬───────┘   target of every composite FK
                                 │
              ┌──────────────────┼───────────────────────┐
              │                  │                        │
     ┌────────▼────────┐  ┌──────▼───────┐      ┌─────────▼─────────┐
     │  FiscalProfile   │  │  Employment  │      │  (future) Vault,   │
     │  one per client  │  │  employer ↔  │      │  Obligations,      │
     │                  │  │  employee,   │      │  Billing           │
     │                  │  │  both FK to  │      │  aggregates — not  │
     │                  │  │ (id, kind)   │      │  yet in the schema │
     └──────────────────┘  └──────────────┘      └────────────────────┘
```

Built today (`apps/api/prisma/schema.prisma`):

- **`User`** / **`Session`** — the single account and its login sessions.
  `User.kdfSalt` and `authHashDigest` are the only credential material the
  server ever sees (see `docs/security-model.md`).
- **`Client`** — `kind: ClientKind` (`COMPANY` | `INDIVIDUAL`) discriminates
  a single table rather than splitting into separate `Company`/`Person`
  entities (see [ADR 0003](adr/0003-clients-as-companies-and-individuals.md)).
  A `CHECK` constraint added directly in the migration SQL (not expressible
  in the Prisma schema language itself) enforces that `legalForm` is set
  only for companies and `socialSecurityNo`/`dateOfBirth` only for
  individuals.
- **`FiscalProfile`** — one-to-one with `Client`, `clientId` is its own
  primary key. Drives the (not-yet-built) obligation engine.
- **`Employment`** — links a `COMPANY` client (employer) to an `INDIVIDUAL`
  client (employee). Both `employerKind` and `employeeKind` are pinned by
  `CHECK` constraints, and the foreign keys are composite
  (`(employerId, employerKind) → Client(id, kind)`), so the database — not
  application code — makes it structurally impossible to record a company
  as somebody's employee. An `EXCLUDE USING gist` constraint over
  `(employerId, employeeId, daterange(startedOn, endedOn))` stops two
  overlapping spells for the same pair while still allowing concurrent
  employment with two different companies.
- **`AuditEvent`** — an append-only log (`entityType`, `entityId`, `action`,
  `metadata` JSON). `action` values are already codes, translated at
  presentation time.
- **`SystemHealth`** — one row per backup attempt (`check`, `status`,
  `detail`), written by `docker/backup.sh`; read by
  `GET /api/v1/system/health-report`.

Not in the schema yet, and out of scope for Phase 0 (see the design spec,
section 14, and the plan's closing "what Phase 0 deliberately leaves out"):
the credential vault and its item encryption, the obligation catalog and
generated instances, and the billing/retainer/payment ledger. When they
arrive, each is its own aggregate hanging off `Client`, per the module
boundary above — none of them reach into each other's tables.
