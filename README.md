# Ledger HQ

Ledger HQ is a self-hosted practice-management system for a small Portuguese
accountancy practice: a single-user, single-tenant application that keeps
client records, fiscal profiles and (in later phases) credential vaulting,
statutory deadlines and retainer billing in one place instead of scattered
across notes and memory. It runs on an office machine, is reached remotely
over a private Tailscale network, and installs as an app on desktop and
phone.

This repository currently implements **Phase 0 — Foundation** (the monorepo,
authentication, the client/fiscal-profile/employment register, the
installable PWA shell, and the operational tooling to run it self-hosted),
**Phase 1 — Vault** (the zero-knowledge encrypted credential vault,
recovery-code account recovery, and offline vault reads), and
**Phase 2 — Obligations** (the statutory fiscal-obligation catalog and
generator, and ad-hoc obligation tracking). The billing ledger described in
the [design specification](docs/superpowers/specs/2026-09-04-ledger-hq-design.md)
is a later phase and is not implemented yet.

## Requirements

- **Node.js 24** (Active LTS). The exact version is pinned in
  [`.nvmrc`](.nvmrc); if you use `nvm`, run `nvm use`.
- **pnpm 11**, via [Corepack](https://nodejs.org/api/corepack.html)
  (`corepack enable`) — the exact version is pinned in the root
  `package.json`'s `packageManager` field, so a bare `pnpm install` after
  enabling Corepack will fetch the right one.
- **Docker** with the Compose plugin (`docker compose version`), for
  PostgreSQL locally and for the full containerized stack in production.
- A **Tailscale** account, needed only to reach the running application
  remotely and to test the installable PWA on a phone — not required to run
  the test suite or develop locally. See
  [`docs/operations.md`](docs/operations.md) for how it's wired in.

## Five-minute local setup

This brings up the API and the web app against a local PostgreSQL container,
without Docker-building either app — the fastest loop for day-to-day
development. For the full containerized stack (what actually runs in
production), see [`docs/operations.md`](docs/operations.md) instead.

```bash
git clone <repo-url> ledger-hq
cd ledger-hq
corepack enable
pnpm install
```

`pnpm install` also generates the Prisma client for `apps/api` automatically
(its `postinstall` script runs `prisma generate`), so no separate codegen
step is needed.

Start PostgreSQL only:

```bash
cp .env.example .env
# edit .env: POSTGRES_PASSWORD in particular should not stay at its
# placeholder value, even for local use.
docker compose up -d postgres
```

Point the API at it and apply migrations. Prisma 7's config
(`apps/api/prisma.config.ts`) reads `DATABASE_URL` from the environment and
does **not** silently load a `.env` file for you, so export it explicitly
before running any `prisma` command:

```bash
cd apps/api
cp .env.example .env
# edit .env: set DATABASE_URL to match the credentials in the root .env,
# and set AUTH_SALT_SECRET to 32 random bytes, e.g.
#   openssl rand -base64 32
set -a && . ./.env && set +a
pnpm exec prisma migrate dev
```

Run both apps, each in its own terminal:

```bash
# terminal 1
pnpm --filter @ledger-hq/api dev      # http://localhost:3000, prefixed at /api/v1

# terminal 2
pnpm --filter @ledger-hq/web dev      # http://localhost:5173, proxies /api/* to the API
```

Open `http://localhost:5173`. With a freshly migrated, empty database this
shows the first-run setup screen (the one-time account bootstrap); once an
account exists it shows the login screen instead.

## Running several worktrees at once

Compose derives its project name from the directory name, so each `git
worktree` already gets its own containers, network and `postgres-data`
volume. The one thing that does collide is the host ports, so
`docker-compose.yml` reads them from the environment:

| Variable        | Default | Published as                      |
| --------------- | ------- | --------------------------------- |
| `POSTGRES_PORT` | `5432`  | `127.0.0.1:${POSTGRES_PORT}:5432` |
| `WEB_PORT`      | `8080`  | `127.0.0.1:${WEB_PORT}:8080`      |

The container-internal ports never change, so the `api` service reaches
`postgres:5432` over the Compose network regardless.

To add a worktree, leave the primary checkout on the defaults and give the
new one its own ports:

```bash
git worktree add ../ledger-hq.worktrees/my-feature -b my-feature
cd ../ledger-hq.worktrees/my-feature
cp ../../ledger-hq/.env .env
# edit .env:
#   POSTGRES_PORT=5433
#   WEB_PORT=8081
docker compose up -d postgres
```

`.env` is gitignored and lives inside each worktree, so the two never share
one. Anything that talks to PostgreSQL _from the host_ rather than from
inside the Compose network needs the same port — in particular `apps/api/.env`:

```bash
cd apps/api
cp .env.example .env
# edit .env: DATABASE_URL=postgresql://<user>:<password>@localhost:5433/ledger_hq
```

The dev servers (`pnpm --filter @ledger-hq/api dev` on 3000, `web` on 5173)
bind their own fixed ports, so run at most one worktree's dev servers at a
time, or override them per worktree (`PORT` for the API,
`pnpm --filter @ledger-hq/web dev -- --port 5174` for the web app).

If two worktrees ever end up with the same directory basename, Compose will
give them the same project name and they _will_ share volumes. Set
`COMPOSE_PROJECT_NAME` in one of their `.env` files to break the tie.

## Tests

Each layer is verified independently, plus one root command that runs all of
them together:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # all packages, via Turborepo
```

Two suites need a real PostgreSQL and are not part of `pnpm test`, run them
explicitly:

```bash
pnpm --filter @ledger-hq/api test:integration   # API against a real Postgres (testcontainers)
pnpm --filter @ledger-hq/web test:e2e           # Playwright, including the offline shell
pnpm --filter @ledger-hq/web i18n:check         # pt-PT / en-GB locale bundles agree on every key
```

`test:integration` starts its own disposable PostgreSQL container via
Testcontainers — it does not need `docker compose up -d postgres` to be
running first, only a working Docker daemon. `test:e2e` does need the API
reachable (Playwright's `webServer` config starts it and the web preview
server itself); see `apps/web/playwright.config.ts`.

## Repository map

```
ledger-hq/
├── apps/
│   ├── api/            NestJS + Prisma 7 + PostgreSQL, ESM, REST under /api/v1
│   └── web/            React + Vite + TanStack Query/Router, installable PWA
├── packages/
│   ├── domain/         Zod schemas, error codes, enums, PT identifier checks — shared by both apps
│   ├── crypto/         Argon2id/HKDF key-derivation primitives — shared by both apps
│   └── config/         shared tsconfig, ESLint and Prettier config
├── docker/             Dockerfiles, Caddyfile, nightly backup script
├── docker-compose.yml  three-container stack: postgres, api, web (behind Caddy)
└── docs/
    ├── architecture.md      module boundaries, API conventions, data model
    ├── security-model.md    what the design protects against, and what it does not
    ├── operations.md        runbook: setup, backup, restore, update, rollback
    └── adr/                 decision records
```

## Further reading

- [`docs/architecture.md`](docs/architecture.md) — module boundaries, API
  conventions, and the data model as built.
- [`docs/operations.md`](docs/operations.md) — the full production runbook:
  bringing up the containerized stack, Tailscale, backups, updates,
  rollback and the quarterly restore drill.
- [`docs/security-model.md`](docs/security-model.md) — the threat model, the
  key-derivation scheme, and what losing the master password means.
