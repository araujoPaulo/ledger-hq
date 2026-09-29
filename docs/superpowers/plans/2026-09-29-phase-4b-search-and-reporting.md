# Phase 4b — Search and Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the operator one box that finds any client, platform, obligation or charge by name, number or prefix, and one page that answers the two questions no single module can — who is both late and behind, and what a period contained.

**Architecture:** One new `apps/api/src/reporting/` module, the place `docs/architecture.md` already reserved for read models that span `clients`, `obligations` and `billing` without any of them importing each other. Search is Postgres full-text: a generated `tsvector` column per searchable table under a `portuguese_unaccent` configuration, a GIN index on each, and one `UNION ALL` query that returns a flat ranked list. Reporting is two hand-written queries — no engine, no query builder. CSV is built in the browser, because a header row is prose and prose is the frontend's job (ADR 0004).

**Tech Stack:** TypeScript (ESM), NestJS 12, Prisma 7 + PostgreSQL 18, Zod, Vitest, Testcontainers, React 19 + TanStack Query/Router, Tailwind, i18next, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-phase-4b-search-and-reporting-design.md`

## Global Constraints

- Node 24, pnpm 11, ESM everywhere. Relative imports inside `apps/api` carry the `.js` extension; imports from `@ledger-hq/domain` do not.
- ADR 0007: **every** raw-SQL `SUM`/`COUNT` carries its own `::int` cast. A `SUM` over an already-cast `int` column is a fresh `bigint`, and a missed cast fails at response serialization, not at migration time.
- ADR 0004 / master spec §10.3: the backend emits error codes, never prose. No report, no CSV and no search response carries a human sentence from the server.
- `reporting.module.ts` imports `AuthModule` and nothing else. It reads other modules' tables through `$queryRaw` — the one deliberate exception to "no module reaches into another module's Prisma models", which is the trade `docs/architecture.md` accepted when it named the module. It calls no sibling service, and no sibling imports it.
- Prisma models no `tsvector`. Each column is declared `Unsupported("tsvector")?` so Prisma leaves it alone, and every read goes through `$queryRaw` with an explicit row type, as `charge_balances` is read today.
- Every new user-facing string needs a key in both `apps/web/src/i18n/locales/pt/` and `apps/web/src/i18n/locales/en/`. `pnpm --filter @ledger-hq/web i18n:check` compares the two bundles and fails on any key present in one and missing in the other. A new namespace must also be registered in both `locales/pt/index.ts` and `locales/en/index.ts`, or `t()` silently returns the key.
- `docs/design/guidelines.md` applies to every component: one `<h1>` per page from `PageHeader`, sections start at `<h2>`; a pending query renders a `*Skeleton.tsx` sibling, never `return null`; every icon-only control has an `aria-label`; nothing in `apps/web/src/ui/` imports from a feature folder.
- Dates on the wire are `YYYY-MM-DD` through `isoDateSchema` (`packages/domain/src/schemas/common.ts`). `DATE` columns are compared against dates, never timestamps.
- After every task: `pnpm lint && pnpm typecheck && pnpm test` must pass before the commit.

## Review Focus

Five conditions the spec implies that no feature test would otherwise reach. Each is pinned to a test in the task that owns the code.

1. **Punctuation-only or emptied input.** An operator holding down backspace sends `q=`, `q=!!!`, `q=&`. Each must answer `[]` with a `200`, never a `500` from a malformed `tsquery` reaching the parser. (Tasks 1 and 3)
2. **A term containing `tsquery` syntax.** A client genuinely named `A & B, Lda.` must be findable, and typing `&` or `:` or `'` must not inject operators into the query. (Tasks 1 and 3)
3. **Credential plaintext is unreachable.** No query shape returns a credential's `label`, `ciphertext` or `iv` — the assertion that pins §3.1 as a property of the design rather than an oversight. (Task 3)
4. **The at-risk report counts instances, not join rows.** A client with three overdue obligations and four open charges reports `overdueObligations: 3`, not `12`. This is the exact bug the two-CTE shape exists to prevent. (Task 6)
5. **Accents fold both ways, and numbers match by prefix.** `Araújo` is found by `araujo`, `Araujo` by `araújo`, and a tax number by its first three digits. (Tasks 2 and 3)

---

### Task 1: `toTsQuery` and the search schema

**Files:**
- Create: `packages/domain/src/search/query.ts`
- Create: `packages/domain/src/search/query.test.ts`
- Create: `packages/domain/src/schemas/search.ts`
- Create: `packages/domain/src/schemas/search.test.ts`
- Modify: `packages/domain/src/index.ts:1-23`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  // packages/domain/src/search/query.ts
  export function toTsQuery(input: string): string | null

  // packages/domain/src/schemas/search.ts
  export const searchQuerySchema: z.ZodType<{ q: string }>
  export type SearchQuery = z.infer<typeof searchQuerySchema>
  ```
  `toTsQuery` returns a `to_tsquery`-safe string, or `null` when nothing searchable was typed. Task 3 calls both.

- [ ] **Step 1: Write the failing tests**

Create `packages/domain/src/search/query.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toTsQuery } from './query'

describe('toTsQuery', () => {
  it('gives a single term the prefix operator', () => {
    expect(toTsQuery('mari')).toBe('mari:*')
  })

  it('joins several terms with & and prefixes only the last', () => {
    expect(toTsQuery('mari lda')).toBe('mari & lda:*')
  })

  it('keeps digits, so a tax number matches by its first digits', () => {
    expect(toTsQuery('501 234')).toBe('501 & 234:*')
  })

  it('keeps letters outside ASCII, so an accented term survives', () => {
    expect(toTsQuery('araújo')).toBe('araújo:*')
  })

  it('collapses runs of whitespace rather than emitting empty terms', () => {
    expect(toTsQuery('  mari   lda  ')).toBe('mari & lda:*')
  })

  it('returns null for an empty or whitespace-only input', () => {
    expect(toTsQuery('')).toBeNull()
    expect(toTsQuery('   ')).toBeNull()
  })

  it('returns null when nothing searchable survives stripping', () => {
    expect(toTsQuery('!!!')).toBeNull()
    expect(toTsQuery('& | !')).toBeNull()
  })

  // Review Focus 2: these characters are tsquery syntax. They must be
  // stripped from the term, never passed through to the parser.
  it('strips tsquery operators out of a term instead of emitting them', () => {
    expect(toTsQuery('A & B')).toBe('a & b:*')
    expect(toTsQuery('a|b')).toBe('ab:*')
    expect(toTsQuery('a:b')).toBe('ab:*')
    expect(toTsQuery('back\\slash')).toBe('backslash:*')
    expect(toTsQuery('(mari)')).toBe('mari:*')
  })

  // Stripping happens WITHIN a term, so a tax number typed with separators
  // stays one token — which is what the stored vector holds. This is the
  // case that decides the rule: '501.442.634' must find the client whose
  // taxId is '501442634', and splitting on the dots would AND three tokens
  // that appear nowhere.
  it('keeps a separated tax number as one searchable token', () => {
    expect(toTsQuery('501.442.634')).toBe('501442634:*')
  })

  // The same rule has a cost, recorded rather than hidden: Postgres's parser
  // splits "O'Brien" into `o` and `brien` when it builds the vector, while
  // this produces `obrien`, which matches neither. Names with apostrophes are
  // found by their other words. Revisit only if that becomes a real miss.
  it('merges an apostrophised term into one token', () => {
    expect(toTsQuery("o'brien")).toBe('obrien:*')
  })

  it('lowercases, so the query does not depend on how the operator typed it', () => {
    expect(toTsQuery('Marisa')).toBe('marisa:*')
  })

  it('never emits a bare colon-star for a term that stripped to nothing', () => {
    expect(toTsQuery('mari ###')).toBe('mari:*')
  })
})
```

Create `packages/domain/src/schemas/search.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { searchQuerySchema } from './search'

describe('searchQuerySchema', () => {
  it('trims the query', () => {
    expect(searchQuerySchema.parse({ q: '  mari  ' })).toEqual({ q: 'mari' })
  })

  it('accepts an empty query — an emptied box is not a validation failure', () => {
    expect(searchQuerySchema.parse({ q: '' })).toEqual({ q: '' })
  })

  it('rejects a query longer than 200 characters', () => {
    expect(searchQuerySchema.safeParse({ q: 'a'.repeat(201) }).success).toBe(false)
  })

  it('rejects unknown keys', () => {
    expect(searchQuerySchema.safeParse({ q: 'mari', limit: 5 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @ledger-hq/domain test
```

Expected: FAIL — `Failed to resolve import "./query"` and `"./search"`; neither module exists.

- [ ] **Step 3: Write `toTsQuery`**

Create `packages/domain/src/search/query.ts`:

```ts
/**
 * Builds a `to_tsquery` string from what the operator typed.
 *
 * `plainto_tsquery` has no prefix operator and `websearch_to_tsquery` does
 * not expose one, so the query is assembled here: split on whitespace, strip
 * each term of everything outside letters and digits, join the survivors
 * with `&`, and give the last one `:*` so three letters find the client
 * (design §3.4).
 *
 * Stripping is what keeps `tsquery` syntax out of the parser: `&`, `|`, `!`,
 * `:`, `(`, `'` and `\` are operators there, and a client genuinely named
 * "A & B, Lda." must be searchable without any of them reaching Postgres.
 *
 * Returns `null` when nothing searchable survives — an operator holding down
 * backspace is not a validation failure, and the caller answers with an
 * empty list rather than an error.
 */
export function toTsQuery(input: string): string | null {
  const terms = input
    .split(/\s+/)
    // `\p{L}` and `\p{N}` keep accented letters and digits; everything else
    // goes, including every tsquery operator.
    .map((term) => term.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase())
    .filter((term) => term.length > 0)

  if (terms.length === 0) return null

  return terms.map((term, index) => (index === terms.length - 1 ? `${term}:*` : term)).join(' & ')
}
```

- [ ] **Step 4: Write the schema**

Create `packages/domain/src/schemas/search.ts`:

```ts
import { z } from 'zod'

/**
 * An empty `q` is valid and answers `[]`: the box is emptied on every
 * backspace, and a 422 per keystroke would be noise, not safety. The cap is
 * there so a pasted document never reaches `toTsQuery`.
 */
export const searchQuerySchema = z
  .object({ q: z.string().trim().max(200) })
  .strict()

export type SearchQuery = z.infer<typeof searchQuerySchema>
```

- [ ] **Step 5: Export both from the barrel**

In `packages/domain/src/index.ts`, add two lines — the schema beside the other schemas, the function beside the other pure helpers:

```ts
export * from './schemas/search'
export * from './search/query'
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/domain test
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS everywhere.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/search packages/domain/src/schemas/search.ts packages/domain/src/schemas/search.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): build the search query from what the operator typed

toTsQuery assembles a prefix-matching to_tsquery: terms stripped to
letters and digits, joined with &, the last one given :*. Stripping is
what keeps tsquery operators out of the parser, so a client named
'A & B, Lda.' is searchable. Nothing searchable returns null.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The text-search configuration and five generated vectors

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp>_search_vectors/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (five models: `Client`, `Platform`, `ObligationDefinition`, `ObligationInstance`, `Charge`)
- Test: `apps/api/test/schema-constraints.integration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a `portuguese_unaccent` text-search configuration and a `"searchVector"` column plus GIN index on each of the five tables. Task 3 queries them.

- [ ] **Step 1: Declare the columns in the Prisma schema**

Prisma has no `tsvector` type. Add one line to each of the five models in `apps/api/prisma/schema.prisma`, placed after the model's last scalar field and before its relations:

```prisma
  /// Generated by the database (Phase 4b). Prisma neither writes nor reads it.
  searchVector     Unsupported("tsvector")?
```

The five models are `Client`, `Platform`, `ObligationDefinition`, `ObligationInstance` and `Charge`. Indentation follows each model's existing alignment — Prisma's formatter will fix it.

- [ ] **Step 2: Create the migration without applying it**

```bash
cd apps/api
set -a && . ./.env && set +a
pnpm exec prisma migrate dev --create-only --name search_vectors
```

Prisma writes a migration adding five `tsvector` columns as plain nullable columns. Replace its entire contents in the next step — the generated version has no configuration, no `GENERATED ALWAYS`, and no indexes.

- [ ] **Step 3: Write the migration**

Replace the whole of `apps/api/prisma/migrations/<timestamp>_search_vectors/migration.sql`:

```sql
-- `unaccent()` is not IMMUTABLE (it reads a dictionary file), so it cannot
-- appear in a generated column's expression. The supported way round is a
-- text-search configuration with `unaccent` mapped ahead of the Portuguese
-- stemmer, which IS immutable when named by a regconfig literal.
--
-- `unaccent` ships in postgres-contrib, which the postgres:18.6-alpine image
-- in docker-compose.yml already carries. Same one-time step btree_gist was
-- in Phase 0 and Phase 3: confirm the extension is available on the
-- production instance before this migration runs there.
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TEXT SEARCH CONFIGURATION portuguese_unaccent (COPY = portuguese);
ALTER TEXT SEARCH CONFIGURATION portuguese_unaccent
  ALTER MAPPING FOR hword, hword_part, word
  WITH unaccent, portuguese_stem;

-- Weights: A is what someone types when they mean to find THIS record, B is
-- a secondary handle, C is prose that should match but never outrank a name.
-- Generated, not trigger-maintained: Postgres recomputes the column on every
-- write of its inputs, so it cannot drift the way a trigger nobody updated
-- for a new column would.

ALTER TABLE "Client" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese_unaccent', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("taxId", '')), 'A') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("email", '')), 'B') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("phone", '')), 'B') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("socialSecurityNo", '')), 'B') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("notes", '')), 'C')
  ) STORED;

CREATE INDEX "Client_searchVector_idx" ON "Client" USING GIN ("searchVector");

ALTER TABLE "Platform" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese_unaccent', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("url", '')), 'B')
  ) STORED;

CREATE INDEX "Platform_searchVector_idx" ON "Platform" USING GIN ("searchVector");

-- The readable name lives on the definition and the period on the instance,
-- because a generated column can only reference its own row. The obligations
-- branch of the search query matches either vector across the join the two
-- tables already have.
ALTER TABLE "ObligationDefinition" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese_unaccent', coalesce("code", '')), 'A') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("legalRef", '')), 'B')
  ) STORED;

CREATE INDEX "ObligationDefinition_searchVector_idx" ON "ObligationDefinition" USING GIN ("searchVector");

ALTER TABLE "ObligationInstance" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese_unaccent', coalesce("periodLabel", '')), 'A') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("reference", '')), 'B') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("notes", '')), 'C')
  ) STORED;

CREATE INDEX "ObligationInstance_searchVector_idx" ON "ObligationInstance" USING GIN ("searchVector");

ALTER TABLE "Charge" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese_unaccent', coalesce("description", '')), 'A') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("periodLabel", '')), 'B') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("writeOffReason", '')), 'C')
  ) STORED;

CREATE INDEX "Charge_searchVector_idx" ON "Charge" USING GIN ("searchVector");
```

Order matters: the extension and the configuration are at the top, because every generated column below names `portuguese_unaccent` and the column definition is validated at `ALTER TABLE` time. A fresh database runs the whole file in order; an existing one runs the same file and rewrites five tables.

**Adding a stored column rewrites the table.** At this database's size that is seconds, but it is still a rewrite: run this during the maintenance window `docs/operations.md` describes for an update, not mid-day.

- [ ] **Step 4: Write the failing constraint tests**

Append to `apps/api/test/schema-constraints.integration.test.ts`, following that file's existing style. If it has no `createClient` helper of its own, copy the one from `apps/api/test/billing.integration.test.ts` verbatim rather than importing it — the test files are self-contained by convention.

```ts
describe('search vectors', () => {
  // Review Focus 5: accents fold both ways, and a number matches by prefix.
  it('finds an accented name from an unaccented query and back', async () => {
    await createClient('501111111', 'Padaria Araújo, Lda.')

    const unaccented = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM "Client" WHERE "searchVector" @@ to_tsquery('portuguese_unaccent', 'araujo:*')
    `
    const accented = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM "Client" WHERE "searchVector" @@ to_tsquery('portuguese_unaccent', 'araújo:*')
    `

    expect(unaccented).toHaveLength(1)
    expect(accented).toHaveLength(1)
  })

  it('finds a client by the first digits of its tax number', async () => {
    await createClient('501442634', 'Padaria Central, Lda.')

    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM "Client" WHERE "searchVector" @@ to_tsquery('portuguese_unaccent', '5014:*')
    `

    expect(rows).toHaveLength(1)
  })

  it('recomputes the vector when the row changes', async () => {
    const clientId = await createClient('501222222', 'Old Name, Lda.')
    await prisma.client.update({ where: { id: clientId }, data: { name: 'Renamed Bakery, Lda.' } })

    const stale = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Client" WHERE "searchVector" @@ to_tsquery('portuguese_unaccent', 'old:*')
    `
    const fresh = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Client" WHERE "searchVector" @@ to_tsquery('portuguese_unaccent', 'renamed:*')
    `

    expect(stale).toEqual([])
    expect(fresh).toHaveLength(1)
  })

  it('weights a name above a note', async () => {
    await createClient('501333333', 'Talho Silva, Lda.')
    const otherId = await createClient('501444444', 'Mercearia Costa, Lda.')
    await prisma.client.update({ where: { id: otherId }, data: { notes: 'Talho vizinho do Silva' } })

    const rows = await prisma.$queryRaw<Array<{ name: string; rank: number }>>`
      SELECT name, ts_rank_cd("searchVector", to_tsquery('portuguese_unaccent', 'silva:*')) AS rank
      FROM "Client"
      WHERE "searchVector" @@ to_tsquery('portuguese_unaccent', 'silva:*')
      ORDER BY rank DESC
    `

    expect(rows[0]?.name).toBe('Talho Silva, Lda.')
  })
})
```

- [ ] **Step 5: Apply the migration and run the tests**

```bash
cd apps/api
set -a && . ./.env && set +a
pnpm exec prisma migrate dev
cd ../..
pnpm --filter @ledger-hq/api test:integration -- schema-constraints
```

Expected: PASS, all four. If the first run fails with `text search configuration "portuguese_unaccent" does not exist`, the migration was applied before the file was rewritten — drop the disposable database and re-run `prisma migrate dev`.

- [ ] **Step 6: Confirm Prisma still round-trips the schema**

```bash
cd apps/api
set -a && . ./.env && set +a
pnpm exec prisma generate
# Prisma 7 removed --from-schema-datamodel and --to-schema-datasource.
pnpm exec prisma migrate diff --from-schema prisma/schema.prisma --to-config-datasource prisma.config.ts --exit-code
cd ../..
```

Expected: `prisma generate` succeeds, and `migrate diff` exits `0` — no drift between the declared schema and the migrated database. An `Unsupported()` column Prisma can see but not type is exactly what keeps that true.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma apps/api/test/schema-constraints.integration.test.ts
git commit -m "feat(api): index five tables for full-text search

A portuguese_unaccent configuration puts unaccent ahead of the stemmer,
which is what makes the expression immutable enough for a generated
column. Five stored tsvector columns with GIN indexes, weighted so a
name outranks a note. Prisma sees them as Unsupported and leaves them
alone.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The `reporting` module and the search endpoint

**Files:**
- Create: `apps/api/src/reporting/reporting.module.ts`
- Create: `apps/api/src/reporting/reporting.controller.ts`
- Create: `apps/api/src/reporting/search.service.ts`
- Modify: `apps/api/src/app.module.ts:1-36`
- Test: `apps/api/test/search.integration.test.ts`

**Interfaces:**
- Consumes: `toTsQuery`, `searchQuerySchema` (Task 1); the five `searchVector` columns (Task 2).
- Produces:
  ```ts
  // apps/api/src/reporting/search.service.ts
  export type SearchHit = {
    type: 'client' | 'platform' | 'obligation' | 'charge'
    id: string
    label: string
    context: string | null
    href: string
    rank: number
  }
  export class SearchService {
    /** Rows carry `typeRank` too; the controller drops it before responding. */
    async search(q: string): Promise<Array<SearchHit & { typeRank: number }>>
  }
  ```
  `GET /api/v1/search?q=<text>`. Tasks 4 and 5 consume this shape on the web side.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/search.integration.test.ts`, following the setup in `apps/api/test/billing.integration.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from 'uuidv7'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { getTestPrisma, resetDatabase } from './database.js'
import { createTestApp } from './app.js'
import { authenticate } from './authenticate.js'

const prisma = getTestPrisma()

let app: INestApplication
let cookie: string[]

async function createClient(taxId: string, name: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const client = await prisma.client.create({
    data: { id: uuidv7(), kind: 'COMPANY', name, taxId, accounting: 'ORGANIZED', legalForm: 'LDA', ...overrides },
  })
  return client.id
}

function get(path: string) {
  return request(app.getHttpServer()).get(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq')
}

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

describe('GET /api/v1/search', () => {
  it('finds a client by a three-letter prefix', async () => {
    const clientId = await createClient('501111111', 'Marisa Unipessoal, Lda.')

    const response = await get('/api/v1/search?q=mari')

    expect(response.status).toBe(200)
    expect(response.body).toEqual([
      expect.objectContaining({ type: 'client', id: clientId, label: 'Marisa Unipessoal, Lda.', href: `/clients/${clientId}` }),
    ])
  })

  // Review Focus 5.
  it('folds accents in both directions', async () => {
    await createClient('501222222', 'Padaria Araújo, Lda.')

    expect((await get('/api/v1/search?q=araujo')).body).toHaveLength(1)
    expect((await get('/api/v1/search?q=ARAÚJO')).body).toHaveLength(1)
  })

  it('finds a client by the first digits of its tax number', async () => {
    await createClient('501442634', 'Padaria Central, Lda.')

    expect((await get('/api/v1/search?q=5014')).body).toHaveLength(1)
  })

  // Review Focus 1.
  it('answers an empty list with a 200 when nothing searchable was typed', async () => {
    await createClient('501333333', 'Padaria Central, Lda.')

    for (const q of ['', '!!!', '%26', '%3A']) {
      const response = await get(`/api/v1/search?q=${q}`)
      expect(response.status).toBe(200)
      expect(response.body).toEqual([])
    }
  })

  // Review Focus 2.
  it('finds a client whose own name contains tsquery syntax', async () => {
    const clientId = await createClient('501444444', 'A & B Contabilidade, Lda.')

    const response = await get('/api/v1/search?q=contabilidade')

    expect(response.status).toBe(200)
    expect(response.body[0]?.id).toBe(clientId)
  })

  // Review Focus 3: the assertion that pins design §3.1.
  it('never returns a credential, its label or its ciphertext', async () => {
    const clientId = await createClient('501555555', 'Padaria Central, Lda.')
    const platform = await prisma.platform.create({
      data: { id: uuidv7(), name: 'Portal das Finanças', url: 'https://portaldasfinancas.gov.pt', authKind: 'PASSWORD' },
    })
    const credential = await prisma.credential.create({
      data: { id: uuidv7(), clientId, platformId: platform.id, label: 'gerente' },
    })
    await prisma.credentialVersion.create({
      data: {
        id: uuidv7(),
        credentialId: credential.id,
        ciphertext: Buffer.from('ciphertext-never-searchable'),
        iv: Buffer.from('0123456789ab'),
      },
    })

    const byLabel = await get('/api/v1/search?q=gerente')
    const byCiphertext = await get('/api/v1/search?q=ciphertext')

    expect(byLabel.body).toEqual([])
    expect(byCiphertext.body).toEqual([])
    // The platform itself IS findable — that is the path to the credential.
    const byPlatform = await get('/api/v1/search?q=finan')
    expect(byPlatform.body).toEqual([expect.objectContaining({ type: 'platform', id: platform.id })])
  })

  it('excludes archived clients', async () => {
    await createClient('501666666', 'Arquivada, Lda.', { archivedAt: new Date() })

    expect((await get('/api/v1/search?q=arquivada')).body).toEqual([])
  })

  it('finds an obligation by its definition name, with the client as context', async () => {
    const clientId = await createClient('501777777', 'Padaria Central, Lda.')
    await prisma.obligationDefinition.create({
      data: { code: 'IVA_TRIM', name: 'IVA trimestral', authority: 'TAX', periodicity: 'QUARTERLY', source: 'CATALOG' },
    })
    const instance = await prisma.obligationInstance.create({
      data: {
        id: uuidv7(),
        clientId,
        definitionCode: 'IVA_TRIM',
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-03-31T00:00:00Z'),
        periodLabel: '2026-Q1',
        dueDate: new Date('2026-05-15T00:00:00Z'),
      },
    })

    const response = await get('/api/v1/search?q=trimestral')

    expect(response.body).toEqual([
      expect.objectContaining({
        type: 'obligation',
        id: instance.id,
        context: 'Padaria Central, Lda.',
        href: `/clients/${clientId}`,
      }),
    ])
  })

  it('finds a charge by its description, including a written-off one', async () => {
    const clientId = await createClient('501888888', 'Padaria Central, Lda.')
    const charge = await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'Relatório único',
        amountCents: 9000,
        issuedOn: new Date('2026-01-01T00:00:00Z'),
        dueOn: new Date('2026-01-31T00:00:00Z'),
        writtenOffAt: new Date(),
        writeOffReason: 'Cortesia',
      },
    })

    const response = await get('/api/v1/search?q=relatorio')

    expect(response.body).toEqual([
      expect.objectContaining({ type: 'charge', id: charge.id, context: 'Padaria Central, Lda.' }),
    ])
  })

  it('caps each type at ten hits', async () => {
    for (let index = 0; index < 12; index += 1) {
      await createClient(`5019${String(index).padStart(5, '0')}`, `Padaria Central ${index}, Lda.`)
    }

    const response = await get('/api/v1/search?q=padaria')

    expect(response.body).toHaveLength(10)
  })

  it('ranks a client above a charge that mentions the same word', async () => {
    const clientId = await createClient('502111111', 'Talho Silva, Lda.')
    await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'Trabalho para o Talho',
        amountCents: 9000,
        issuedOn: new Date('2026-01-01T00:00:00Z'),
        dueOn: new Date('2026-01-31T00:00:00Z'),
      },
    })

    const response = await get('/api/v1/search?q=talho')

    expect(response.body[0]?.type).toBe('client')
  })

  it('requires a session', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/search?q=mari')

    expect(response.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @ledger-hq/api test:integration -- search
```

Expected: FAIL with `404` on every request — the route does not exist.

- [ ] **Step 3: Write the search service**

Create `apps/api/src/reporting/search.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
import { toTsQuery } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'

export type SearchHit = {
  type: 'client' | 'platform' | 'obligation' | 'charge'
  id: string
  label: string
  /** The owning client, for a hit that only makes sense underneath one. */
  context: string | null
  /** The app route that opens it. */
  href: string
  rank: number
}

/** Per type, so one broad term never drags four whole tables into this process. */
const PER_TYPE_LIMIT = 10
const OVERALL_LIMIT = 25

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One flat ranked list across four tables (design §3.5). Credentials are
   * absent by construction, not by filter: the vault is zero-knowledge, the
   * server holds ciphertext it has no key for, and `Credential.label` is a
   * per-client disambiguator that carries no meaning away from the client
   * row which would already have matched (§3.1).
   */
  async search(q: string): Promise<Array<SearchHit & { typeRank: number }>> {
    const tsquery = toTsQuery(q)
    // Nothing searchable was typed. An operator holding down backspace is
    // not a failure, so this is an empty list and a 200, not an error.
    if (tsquery === null) return []

    // `typeRank` is a fixed per-type tiebreak, so a client outranks a charge
    // that scores the same. Each branch caps itself; the outer query caps
    // the union.
    // The raw rows carry `typeRank`, which orders the union and is not
    // part of the response; the controller drops it.
    const rows = await this.prisma.$queryRaw<Array<SearchHit & { typeRank: number }>>`
      (
        SELECT 'client' AS type, c.id::text AS id, c.name AS label, NULL::text AS context,
               '/clients/' || c.id::text AS href,
               ts_rank_cd(c."searchVector", to_tsquery('portuguese_unaccent', ${tsquery})) AS rank,
               1 AS "typeRank"
        FROM "Client" c
        WHERE c."searchVector" @@ to_tsquery('portuguese_unaccent', ${tsquery})
          AND c."archivedAt" IS NULL
        ORDER BY rank DESC, label ASC
        LIMIT ${PER_TYPE_LIMIT}
      )
      UNION ALL
      (
        SELECT 'platform' AS type, p.id::text AS id, p.name AS label, NULL::text AS context,
               '/vault/platforms' AS href,
               ts_rank_cd(p."searchVector", to_tsquery('portuguese_unaccent', ${tsquery})) AS rank,
               2 AS "typeRank"
        FROM "Platform" p
        WHERE p."searchVector" @@ to_tsquery('portuguese_unaccent', ${tsquery})
        ORDER BY rank DESC, label ASC
        LIMIT ${PER_TYPE_LIMIT}
      )
      UNION ALL
      (
        -- Either vector matches: the readable name is on the definition, the
        -- period and reference on the instance, because a generated column
        -- can only reference its own row.
        SELECT 'obligation' AS type, i.id::text AS id, d.name || ' · ' || i."periodLabel" AS label,
               c.name AS context,
               '/clients/' || i."clientId"::text AS href,
               GREATEST(
                 ts_rank_cd(i."searchVector", to_tsquery('portuguese_unaccent', ${tsquery})),
                 ts_rank_cd(d."searchVector", to_tsquery('portuguese_unaccent', ${tsquery}))
               ) AS rank,
               3 AS "typeRank"
        FROM "ObligationInstance" i
        JOIN "ObligationDefinition" d ON d.code = i."definitionCode"
        JOIN "Client" c ON c.id = i."clientId"
        WHERE (i."searchVector" @@ to_tsquery('portuguese_unaccent', ${tsquery})
            OR d."searchVector" @@ to_tsquery('portuguese_unaccent', ${tsquery}))
          AND c."archivedAt" IS NULL
        ORDER BY rank DESC, label ASC
        LIMIT ${PER_TYPE_LIMIT}
      )
      UNION ALL
      (
        -- Written-off charges are included: looking one up is a legitimate
        -- reason to search, and the ledger still shows it.
        SELECT 'charge' AS type, ch.id::text AS id, ch.description AS label,
               c.name AS context,
               '/clients/' || ch."clientId"::text AS href,
               ts_rank_cd(ch."searchVector", to_tsquery('portuguese_unaccent', ${tsquery})) AS rank,
               4 AS "typeRank"
        FROM "Charge" ch
        JOIN "Client" c ON c.id = ch."clientId"
        WHERE ch."searchVector" @@ to_tsquery('portuguese_unaccent', ${tsquery})
          AND c."archivedAt" IS NULL
        ORDER BY rank DESC, label ASC
        LIMIT ${PER_TYPE_LIMIT}
      )
      ORDER BY rank DESC, "typeRank" ASC, label ASC
      LIMIT ${OVERALL_LIMIT}
    `

    return rows
  }
}
```

`typeRank` is selected because a `SELECT` list without it cannot be ordered by it across a `UNION ALL`. It is dropped in the controller rather than here, so the service's return type stays the row shape the query actually produces.

- [ ] **Step 4: Write the controller and the module**

Create `apps/api/src/reporting/reporting.controller.ts`:

```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { searchQuerySchema } from '@ledger-hq/domain'
import type { SearchQuery } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { SearchService } from './search.service.js'
import type { SearchHit } from './search.service.js'

@Controller()
@UseGuards(SessionGuard)
export class ReportingController {
  constructor(private readonly search: SearchService) {}

  @Get('search')
  async find(@Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery): Promise<SearchHit[]> {
    const hits = await this.search.search(query.q)
    // `typeRank` exists to order the union and is not part of the contract.
    return hits.map(({ type, id, label, context, href, rank }) => ({ type, id, label, context, href, rank }))
  }
}
```

`@Controller()` with no prefix, because this controller owns both `/search` and, from Task 6, `/reporting/*` — two different top-level paths under one module.

Create `apps/api/src/reporting/reporting.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { PrismaService } from '../common/prisma.service.js'
import { ReportingController } from './reporting.controller.js'
import { SearchService } from './search.service.js'

/**
 * The cross-module read layer `docs/architecture.md` reserved: `clients` is
 * the core and `vault`/`obligations`/`billing` never import one another, so
 * a view spanning two of them belongs here. It imports `auth` for
 * `SessionGuard` and nothing else, reads other modules' tables through
 * `$queryRaw`, calls no sibling service, and no sibling imports it.
 */
@Module({
  imports: [AuthModule],
  controllers: [ReportingController],
  providers: [SearchService, PrismaService],
})
export class ReportingModule {}
```

- [ ] **Step 5: Register the module**

In `apps/api/src/app.module.ts`, add the import beside the others and `ReportingModule` to the `imports` array, after `SystemModule`:

```ts
import { ReportingModule } from './reporting/reporting.module.js'
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/api test:integration -- search
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS everywhere.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/reporting apps/api/src/app.module.ts apps/api/test/search.integration.test.ts
git commit -m "feat(api): search clients, platforms, obligations and charges

One UNION ALL over four tsvector columns, ranked with ts_rank_cd and a
fixed per-type tiebreak, capped per type and overall. Credentials are
absent by construction: the server holds ciphertext it has no key for.

The reporting module is the cross-module read layer architecture.md
reserved — it imports auth and nothing else.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The search results page

> **Correction applied during execution.** This task originally specified four
> tests — grouping, context, empty, and the empty-query prompt — and none for
> the pending or error branch. Those two are exactly what this plan's Global
> Constraints care about: the skeleton-never-null rule, and the distinction
> between "nothing found" and "the request failed". Add a test with an
> unresolved promise asserting the skeleton renders, and one with a rejected
> promise asserting the error surface appears **and** the empty-result text
> does not.

**Files:**
- Create: `apps/web/src/search/api.ts`
- Create: `apps/web/src/search/SearchResultsPage.tsx`
- Create: `apps/web/src/search/SearchResultsSkeleton.tsx`
- Create: `apps/web/src/search/SearchResultsPage.test.tsx`
- Modify: `apps/web/src/router.tsx:1-70`
- Modify: `apps/web/src/i18n/locales/pt/common.json`
- Modify: `apps/web/src/i18n/locales/en/common.json`

**Interfaces:**
- Consumes: `GET /api/v1/search?q=` (Task 3).
- Produces:
  ```ts
  // apps/web/src/search/api.ts
  export type SearchHitType = 'client' | 'platform' | 'obligation' | 'charge'
  export type SearchHit = { type: SearchHitType; id: string; label: string; context: string | null; href: string; rank: number }
  export function getSearchResults(q: string): Promise<SearchHit[]>

  // apps/web/src/search/SearchResultsPage.tsx
  export function SearchResultsPage(): JSX.Element
  ```
  A `/search` route reading `?q=`. Task 5 navigates to it.

- [ ] **Step 1: Add the i18n keys, both locales**

The search strings live in `common`, not a new namespace: the box is part of the shell, and `common:search.label` is what design §3.6 names.

In `apps/web/src/i18n/locales/pt/common.json`, add a `search` block after `nav`:

```json
  "search": {
    "label": "Pesquisar",
    "placeholder": "Pesquisar clientes, plataformas, obrigações…",
    "resultsTitle": "Resultados",
    "empty": "Nada encontrado.",
    "emptyHint": "Tenta menos letras, ou o número de contribuinte.",
    "prompt": "Escreve para pesquisar.",
    "group": {
      "client": "Clientes",
      "platform": "Plataformas",
      "obligation": "Obrigações",
      "charge": "Cobranças"
    }
  },
```

In `apps/web/src/i18n/locales/en/common.json`, the same block:

```json
  "search": {
    "label": "Search",
    "placeholder": "Search clients, platforms, obligations…",
    "resultsTitle": "Results",
    "empty": "Nothing found.",
    "emptyHint": "Try fewer letters, or the tax number.",
    "prompt": "Type to search.",
    "group": {
      "client": "Clients",
      "platform": "Platforms",
      "obligation": "Obligations",
      "charge": "Charges"
    }
  },
```

- [ ] **Step 2: Write the failing component tests**

Create `apps/web/src/search/SearchResultsPage.test.tsx`, following the router-and-i18n harness in `apps/web/src/billing/ReceivablesSection.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const getSearchResultsMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getSearchResults: getSearchResultsMock }))

const { SearchResultsPage } = await import('./SearchResultsPage')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderPage(initialUrl: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const searchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/search',
    validateSearch: (search: Record<string, unknown>) => ({ q: typeof search.q === 'string' ? search.q : '' }),
    component: SearchResultsPage,
  })
  const clientRoute = createRoute({ getParentRoute: () => rootRoute, path: '/clients/$clientId', component: () => null })
  const platformsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/vault/platforms', component: () => null })
  const router = createRouter({
    routeTree: rootRoute.addChildren([searchRoute, clientRoute, platformsRoute]),
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getSearchResultsMock.mockReset()
})

describe('SearchResultsPage', () => {
  it('groups hits under a heading per type', async () => {
    getSearchResultsMock.mockResolvedValue([
      { type: 'client', id: 'c1', label: 'Marisa Unipessoal, Lda.', context: null, href: '/clients/c1', rank: 0.9 },
      { type: 'charge', id: 'ch1', label: 'Trabalho extra', context: 'Marisa Unipessoal, Lda.', href: '/clients/c1', rank: 0.2 },
    ])

    renderPage('/search?q=mari')

    expect(await screen.findByRole('heading', { name: /^clientes$/i })).toBeVisible()
    expect(screen.getByRole('heading', { name: /^cobranças$/i })).toBeVisible()
    expect(screen.getByRole('link', { name: /marisa unipessoal/i })).toHaveAttribute('href', '/clients/c1')
  })

  it('shows the owning client as context on a hit that has one', async () => {
    getSearchResultsMock.mockResolvedValue([
      { type: 'obligation', id: 'o1', label: 'IVA trimestral · 2026-Q1', context: 'Padaria Central, Lda.', href: '/clients/c1', rank: 0.5 },
    ])

    renderPage('/search?q=iva')

    expect(await screen.findByText('Padaria Central, Lda.')).toBeVisible()
  })

  it('shows an empty state when the search found nothing', async () => {
    getSearchResultsMock.mockResolvedValue([])

    renderPage('/search?q=zzzz')

    expect(await screen.findByText(/nada encontrado/i)).toBeVisible()
  })

  it('prompts rather than searching when the query is empty', async () => {
    renderPage('/search?q=')

    expect(await screen.findByText(/escreve para pesquisar/i)).toBeVisible()
    await waitFor(() => expect(getSearchResultsMock).not.toHaveBeenCalled())
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- SearchResultsPage
```

Expected: FAIL — `Failed to resolve import "./SearchResultsPage"`.

- [ ] **Step 4: Write the API client**

Create `apps/web/src/search/api.ts`:

```ts
import { apiFetch } from '../api/client'

export type SearchHitType = 'client' | 'platform' | 'obligation' | 'charge'

export type SearchHit = {
  type: SearchHitType
  id: string
  label: string
  /** The owning client, for a hit that only makes sense underneath one. */
  context: string | null
  href: string
  rank: number
}

export function getSearchResults(q: string): Promise<SearchHit[]> {
  return apiFetch(`/search?q=${encodeURIComponent(q)}`)
}
```

- [ ] **Step 5: Write the skeleton**

Create `apps/web/src/search/SearchResultsSkeleton.tsx`, matching the shape it replaces (`docs/design/guidelines.md` §2):

```tsx
import { Card, Skeleton } from '../ui'

export function SearchResultsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton width="6rem" height="1.25rem" />
      <Card padding="none" className="flex flex-col gap-3 px-5 py-4">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} height="0.875rem" />
        ))}
      </Card>
    </div>
  )
}
```

- [ ] **Step 6: Write the page**

Create `apps/web/src/search/SearchResultsPage.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { SearchX } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Card, DataList, EmptyState, PageHeader } from '../ui'
import { getSearchResults } from './api'
import type { SearchHitType } from './api'
import { SearchResultsSkeleton } from './SearchResultsSkeleton'

// Fixed order, so the groups do not reshuffle as ranks change between
// keystrokes. Matches the server's own typeRank.
const GROUPS: SearchHitType[] = ['client', 'platform', 'obligation', 'charge']

export function SearchResultsPage() {
  const { t } = useTranslation('common')
  const { q } = useSearch({ from: '/search' })

  const results = useQuery({
    queryKey: ['search', q],
    queryFn: () => getSearchResults(q),
    // An empty box is not a search. Without this the page fires a request on
    // every backspace down to zero characters.
    enabled: q.trim().length > 0,
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('search.resultsTitle')} description={q} />

      {q.trim().length === 0 ? (
        <p className="text-sm text-muted">{t('search.prompt')}</p>
      ) : results.isPending ? (
        <SearchResultsSkeleton />
      ) : results.isError ? (
        <ErrorMessage error={results.error} />
      ) : results.data.length === 0 ? (
        <EmptyState icon={SearchX} title={t('search.empty')} description={t('search.emptyHint')} />
      ) : (
        GROUPS.filter((group) => results.data.some((hit) => hit.type === group)).map((group) => (
          <section key={group} className="flex flex-col gap-3">
            {/* PageHeader owns the h1; every group is a section of it. */}
            <h2 className="text-lg font-semibold">{t(`search.group.${group}`)}</h2>
            <Card padding="none" className="px-5">
              <DataList>
                {results.data
                  .filter((hit) => hit.type === group)
                  .map((hit) => (
                    <DataList.Row
                      key={`${hit.type}:${hit.id}`}
                      label={
                        <Link to={hit.href} className="font-medium">
                          {hit.label}
                        </Link>
                      }
                      value={hit.context === null ? null : <span className="text-sm text-muted">{hit.context}</span>}
                    />
                  ))}
              </DataList>
            </Card>
          </section>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 7: Add the route**

In `apps/web/src/router.tsx`, import the page and add the route, then include it in `addChildren`:

```tsx
import { SearchResultsPage } from './search/SearchResultsPage'

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  // The query lives in the URL so a result list is linkable and survives a
  // reload. A missing or non-string `q` reads as empty rather than throwing.
  validateSearch: (search: Record<string, unknown>) => ({ q: typeof search.q === 'string' ? search.q : '' }),
  component: SearchResultsPage,
})
```

```tsx
  routeTree: rootRoute.addChildren([indexRoute, clientsRoute, clientNewRoute, clientDetailRoute, vaultSetupRoute, platformsRoute, searchRoute]),
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/web test -- SearchResultsPage
pnpm --filter @ledger-hq/web i18n:check
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS everywhere, and `i18n:check` reports no key missing from either locale.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/search apps/web/src/router.tsx apps/web/src/i18n/locales
git commit -m "feat(web): a search results page, grouped by type

The query lives in the URL, so a result list is linkable and survives a
reload. An empty box prompts instead of searching.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The search box in the shell

**Files:**
- Create: `apps/web/src/search/SearchBox.tsx`
- Create: `apps/web/src/search/SearchBox.test.tsx`
- Modify: `apps/web/src/shell/Sidebar.tsx:1-55`
- Modify: `apps/web/src/shell/MobileNav.tsx:16-45`

**Interfaces:**
- Consumes: the `/search` route (Task 4), `common:search.*` keys (Task 4).
- Produces:
  ```ts
  export function SearchBox(): JSX.Element
  ```
  Desktop only. Mobile gets an icon button in `MobileTopBar` that navigates to `/search`.

**A note the implementer needs before writing the input.** `apps/web/src/ui/` has no `Input` component — `docs/design/roadmap.md` introduces `Input`/`Select`/`Checkbox` in UI refresh **Stage 2**, which has not landed. Do **not** add one to `ui/` here: a form primitive designed against one search box and no form is the wrong shape, and Stage 2 designs it against `ClientFormPage`, the largest form in the app. Ship a plain styled `<input type="search">`, exactly as `ClientListPage.tsx:31-36` already does for its filter bar, and let Stage 2 adopt both in one pass. This is a deliberate, temporary duplication of two Tailwind class strings, recorded here so it is not mistaken for an oversight.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/search/SearchBox.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import { initI18n } from '../i18n'
import { SearchBox } from './SearchBox'

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderBox() {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: SearchBox })
  const searchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/search',
    validateSearch: (search: Record<string, unknown>) => ({ q: typeof search.q === 'string' ? search.q : '' }),
    component: SearchBox,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, searchRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  const result = render(
    <I18nextProvider i18n={i18next}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  )

  return { ...result, router }
}

describe('SearchBox', () => {
  it('navigates to the results route with what was typed', async () => {
    const { router } = renderBox()

    await userEvent.type(screen.getByRole('searchbox'), 'mari')

    // 200 ms debounce, so this is the first navigation, not the fourth.
    await waitFor(() => expect(router.state.location.pathname).toBe('/search'))
    await waitFor(() => expect(router.state.location.searchStr).toContain('q=mari'))
  })

  it('focuses the box when "/" is pressed outside a text field', async () => {
    renderBox()
    const box = screen.getByRole('searchbox')
    expect(box).not.toHaveFocus()

    await userEvent.keyboard('/')

    expect(box).toHaveFocus()
  })

  it('does not steal "/" while a text field has focus', async () => {
    renderBox()
    const box = screen.getByRole('searchbox')
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    outside.focus()

    await userEvent.keyboard('/')

    expect(box).not.toHaveFocus()
    expect(outside.value).toBe('/')
    outside.remove()
  })

  it('clears and blurs on Escape', async () => {
    renderBox()
    const box = screen.getByRole('searchbox')

    await userEvent.type(box, 'mari')
    await userEvent.keyboard('{Escape}')

    expect(box).toHaveValue('')
    expect(box).not.toHaveFocus()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- SearchBox
```

Expected: FAIL — `Failed to resolve import "./SearchBox"`.

- [ ] **Step 3: Write the box**

Create `apps/web/src/search/SearchBox.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'

/**
 * The shell's only text input, so it owns the `/` shortcut.
 *
 * A plain `<input>` on purpose: `apps/web/src/ui/` has no `Input` yet — UI
 * refresh Stage 2 introduces it, designed against `ClientFormPage` rather
 * than against one search box. `ClientListPage`'s filter bar is the same
 * plain shape for the same reason; Stage 2 adopts both at once.
 */
export function SearchBox() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/') return

      // `/` is a literal character in any field the operator is typing in.
      // Stealing it there would make the box unusable and every other input
      // lossy.
      const active = document.activeElement
      const isTextField =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      if (isTextField) return

      event.preventDefault()
      inputRef.current?.focus()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (value.trim().length === 0) return

    // Debounced and `replace: true`: one history entry for a search, not one
    // per keystroke, so Back leaves the results rather than walking them.
    const timer = setTimeout(() => {
      void navigate({ to: '/search', search: { q: value }, replace: true })
    }, 200)

    return () => clearTimeout(timer)
  }, [value, navigate])

  return (
    <div className="relative px-2">
      <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
      <input
        ref={inputRef}
        type="search"
        aria-label={t('search.label')}
        placeholder={t('search.placeholder')}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          setValue('')
          event.currentTarget.blur()
        }}
        className="w-full rounded-control border border-line bg-ground py-1.5 pl-8 pr-2 text-sm placeholder:text-subtle"
      />
    </div>
  )
}
```

- [ ] **Step 4: Mount it on desktop**

In `apps/web/src/shell/Sidebar.tsx`, import `SearchBox` and render it between the wordmark `<span>` and the `<div className="flex flex-1 ...">` that holds the destinations:

```tsx
      <SearchBox />
```

- [ ] **Step 5: Add the mobile entry point**

`MobileTopBar` has no room for a box beside the mark, the connection status and the account menu, so it gets an icon-only link instead. In `apps/web/src/shell/MobileNav.tsx`, add `Search` to the `lucide-react` import and put the link first inside the trailing `<span>`:

```tsx
      <span className="flex items-center gap-2">
        {/* Icon-only, so it carries the label the desktop box shows. */}
        <Link
          to="/search"
          search={{ q: '' }}
          aria-label={t('search.label')}
          className="flex h-9 w-9 items-center justify-center rounded-surface text-muted"
        >
          <Search aria-hidden="true" className="h-5 w-5" />
        </Link>
        <ConnectionStatus />
        <AccountMenu />
      </span>
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/web test -- SearchBox
pnpm --filter @ledger-hq/web test -- Sidebar MobileNav AppLayout
pnpm --filter @ledger-hq/web i18n:check
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS everywhere. `AppLayout.test.tsx` and `MobileNav.test.tsx` already assert the shell's structure — if either counts links or roles, update the count rather than the component.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/search apps/web/src/shell
git commit -m "feat(web): a search box in the shell, with the / shortcut

Desktop gets the box in the sidebar; mobile gets an icon link to the
results route, because the top bar has no room for an input. The
shortcut never fires while a text field has focus.

Deliberately a plain input: ui/ has no Input until UI refresh Stage 2,
which designs it against the client form rather than this box.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The at-risk report

**Files:**
- Create: `packages/domain/src/schemas/reporting.ts`
- Create: `packages/domain/src/schemas/reporting.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `apps/api/src/reporting/reports.service.ts`
- Modify: `apps/api/src/reporting/reporting.controller.ts`
- Modify: `apps/api/src/reporting/reporting.module.ts`
- Test: `apps/api/test/reporting.integration.test.ts`

**Interfaces:**
- Consumes: `charge_balances` (Phase 3), `payment_credits` (**Phase 4a, Task 2**), `isoDateSchema`.
- Produces:
  ```ts
  // packages/domain/src/schemas/reporting.ts
  export const atRiskQuerySchema: z.ZodType<{ asOf?: string }>
  export type AtRiskQuery = z.infer<typeof atRiskQuerySchema>

  // apps/api/src/reporting/reports.service.ts
  export type AtRiskRow = {
    clientId: string
    clientName: string
    overdueObligations: number
    oldestDueDate: string
    grossOutstandingCents: number
    creditCents: number
    outstandingCents: number
    oldestChargeDueOn: string
  }
  export class ReportsService { async atRisk(asOf: Date): Promise<AtRiskRow[]> }
  ```
  `GET /api/v1/reporting/at-risk?asOf=YYYY-MM-DD`. Tasks 8 and 9 consume this shape.

**Hard dependency on Phase 4a.** This report reads `payment_credits`, the view Phase 4a Task 2 creates. A client whose unspent credit covers its debt is not in arrears and must not be listed (4a spec §4.4, 4b spec §3.7). If 4a has not landed, the query fails at runtime with `relation "payment_credits" does not exist` — loudly, which is the point. Step 1 below checks for it before anything else is written.

- [ ] **Step 1: Confirm Phase 4a has landed**

```bash
cd apps/api
set -a && . ./.env && set +a
pnpm exec prisma db execute --stdin <<'SQL'
SELECT 1 / (SELECT COUNT(*)::int FROM pg_views WHERE viewname = 'payment_credits') AS "payment_credits_exists";
SQL
cd ../..
```

Expected: success. A `division by zero` error means `payment_credits` does not exist — **stop here**: Phase 4a Task 2 must be merged before this task can be implemented. Do not work around it by reading `charge_balances` alone; that ships a report that overstates arrears and contradicts the receivables list on the same data.

- [ ] **Step 2: Write the failing schema tests**

Create `packages/domain/src/schemas/reporting.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { atRiskQuerySchema } from './reporting'

describe('atRiskQuerySchema', () => {
  it('accepts an ISO date', () => {
    expect(atRiskQuerySchema.parse({ asOf: '2026-09-29' })).toEqual({ asOf: '2026-09-29' })
  })

  it('accepts no date at all — the caller defaults to today', () => {
    expect(atRiskQuerySchema.parse({})).toEqual({})
  })

  it('rejects a non-ISO date', () => {
    expect(atRiskQuerySchema.safeParse({ asOf: '29/09/2026' }).success).toBe(false)
  })

  it('rejects unknown keys', () => {
    expect(atRiskQuerySchema.safeParse({ asOf: '2026-09-29', limit: 5 }).success).toBe(false)
  })
})
```

- [ ] **Step 3: Write the failing integration tests**

Create `apps/api/test/reporting.integration.test.ts`, with the same harness as `apps/api/test/search.integration.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from 'uuidv7'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { getTestPrisma, resetDatabase } from './database.js'
import { createTestApp } from './app.js'
import { authenticate } from './authenticate.js'

const prisma = getTestPrisma()

let app: INestApplication
let cookie: string[]

const AS_OF = '2026-06-30'

async function createClient(taxId: string, name: string): Promise<string> {
  const client = await prisma.client.create({
    data: { id: uuidv7(), kind: 'COMPANY', name, taxId, accounting: 'ORGANIZED', legalForm: 'LDA' },
  })
  return client.id
}

async function overdueObligation(clientId: string, periodLabel: string, dueDate: string): Promise<void> {
  await prisma.obligationDefinition.upsert({
    where: { code: 'IVA_TRIM' },
    create: { code: 'IVA_TRIM', name: 'IVA trimestral', authority: 'TAX', periodicity: 'QUARTERLY', source: 'CATALOG' },
    update: {},
  })
  await prisma.obligationInstance.create({
    data: {
      id: uuidv7(),
      clientId,
      definitionCode: 'IVA_TRIM',
      periodStart: new Date(`${dueDate}T00:00:00Z`),
      periodEnd: new Date(`${dueDate}T00:00:00Z`),
      periodLabel,
      dueDate: new Date(`${dueDate}T00:00:00Z`),
    },
  })
}

async function openCharge(clientId: string, amountCents: number, dueOn: string): Promise<string> {
  const charge = await prisma.charge.create({
    data: {
      id: uuidv7(),
      clientId,
      kind: 'EXTRA',
      description: `Ad-hoc ${dueOn}`,
      amountCents,
      issuedOn: new Date('2026-01-01T00:00:00Z'),
      dueOn: new Date(`${dueOn}T00:00:00Z`),
    },
  })
  return charge.id
}

function get(path: string) {
  return request(app.getHttpServer()).get(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq')
}

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

describe('GET /api/v1/reporting/at-risk', () => {
  it('lists a client that is both overdue and in arrears', async () => {
    const clientId = await createClient('501111111', 'Padaria Central, Lda.')
    await overdueObligation(clientId, '2026-Q1', '2026-05-15')
    await openCharge(clientId, 20000, '2026-05-31')

    const response = await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual([
      expect.objectContaining({
        clientId,
        clientName: 'Padaria Central, Lda.',
        overdueObligations: 1,
        oldestDueDate: '2026-05-15',
        grossOutstandingCents: 20000,
        creditCents: 0,
        outstandingCents: 20000,
        oldestChargeDueOn: '2026-05-31',
      }),
    ])
  })

  it('omits a client that is overdue but paid up', async () => {
    const clientId = await createClient('501222222', 'Só Atrasado, Lda.')
    await overdueObligation(clientId, '2026-Q1', '2026-05-15')

    expect((await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)).body).toEqual([])
  })

  it('omits a client that is in arrears but up to date on deadlines', async () => {
    const clientId = await createClient('501333333', 'Só Devedor, Lda.')
    await openCharge(clientId, 20000, '2026-05-31')

    expect((await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)).body).toEqual([])
  })

  it('omits an obligation that is done, however late it was', async () => {
    const clientId = await createClient('501444444', 'Entregue, Lda.')
    await overdueObligation(clientId, '2026-Q1', '2026-05-15')
    await prisma.obligationInstance.updateMany({ where: { clientId }, data: { status: 'DONE', completedAt: new Date() } })
    await openCharge(clientId, 20000, '2026-05-31')

    expect((await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)).body).toEqual([])
  })

  // Review Focus 4: the reason the query uses two CTEs.
  it('counts obligation instances, not join rows', async () => {
    const clientId = await createClient('501555555', 'Multiplicado, Lda.')
    await overdueObligation(clientId, '2026-Q1', '2026-03-15')
    await overdueObligation(clientId, '2026-Q2', '2026-04-15')
    await overdueObligation(clientId, '2026-Q3', '2026-05-15')
    await openCharge(clientId, 1000, '2026-02-28')
    await openCharge(clientId, 2000, '2026-03-31')
    await openCharge(clientId, 3000, '2026-04-30')
    await openCharge(clientId, 4000, '2026-05-31')

    const [row] = (await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)).body

    // Three obligations and four charges. A single-pass join reports 12 and
    // 30000; the CTEs report 3 and 10000.
    expect(row.overdueObligations).toBe(3)
    expect(row.grossOutstandingCents).toBe(10000)
  })

  // The Phase 4a contract: credit is netted, and a client it fully covers is
  // not in arrears.
  it('nets unspent credit, and drops a client whose credit covers the debt', async () => {
    const partly = await createClient('501666666', 'Parcialmente Coberto, Lda.')
    await overdueObligation(partly, '2026-Q1', '2026-05-15')
    await openCharge(partly, 20000, '2026-05-31')
    await prisma.payment.create({
      data: { id: uuidv7(), clientId: partly, amountCents: 15000, receivedOn: new Date('2026-01-05T00:00:00Z'), method: 'TRANSFER' },
    })

    const fully = await createClient('501777777', 'Totalmente Coberto, Lda.')
    await overdueObligation(fully, '2026-Q1', '2026-05-15')
    await openCharge(fully, 9000, '2026-05-31')
    await prisma.payment.create({
      data: { id: uuidv7(), clientId: fully, amountCents: 30000, receivedOn: new Date('2026-01-05T00:00:00Z'), method: 'TRANSFER' },
    })

    const body = (await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)).body

    expect(body).toHaveLength(1)
    expect(body[0]).toEqual(
      expect.objectContaining({ clientId: partly, grossOutstandingCents: 20000, creditCents: 15000, outstandingCents: 5000 }),
    )
  })

  it('excludes archived clients and written-off charges', async () => {
    const archived = await createClient('501888888', 'Arquivado, Lda.')
    await overdueObligation(archived, '2026-Q1', '2026-05-15')
    await openCharge(archived, 20000, '2026-05-31')
    await prisma.client.update({ where: { id: archived }, data: { archivedAt: new Date() } })

    const forgiven = await createClient('501999999', 'Perdoado, Lda.')
    await overdueObligation(forgiven, '2026-Q1', '2026-05-15')
    const chargeId = await openCharge(forgiven, 20000, '2026-05-31')
    await prisma.charge.update({ where: { id: chargeId }, data: { writtenOffAt: new Date(), writeOffReason: 'Cortesia' } })

    expect((await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)).body).toEqual([])
  })

  // ADR 0007: a missed ::int hands back a bigint and fails at serialization,
  // in the response, not at migration time.
  it('returns every numeric field as a JSON-safe number', async () => {
    const clientId = await createClient('502111111', 'Padaria Central, Lda.')
    await overdueObligation(clientId, '2026-Q1', '2026-05-15')
    await openCharge(clientId, 20000, '2026-05-31')

    const [row] = (await get(`/api/v1/reporting/at-risk?asOf=${AS_OF}`)).body

    expect(typeof row.overdueObligations).toBe('number')
    expect(typeof row.grossOutstandingCents).toBe('number')
    expect(typeof row.creditCents).toBe('number')
    expect(typeof row.outstandingCents).toBe('number')
  })

  it('rejects a malformed asOf', async () => {
    const response = await get('/api/v1/reporting/at-risk?asOf=29/09/2026')

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('common.validation_failed')
  })

  it('requires a session', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/reporting/at-risk')

    expect(response.status).toBe(401)
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
pnpm --filter @ledger-hq/domain test
pnpm --filter @ledger-hq/api test:integration -- reporting
```

Expected: FAIL — the schema module does not exist, and every request 404s.

- [ ] **Step 5: Write the schema**

Create `packages/domain/src/schemas/reporting.ts`:

```ts
import { z } from 'zod'
import { isoDateSchema } from './common'

/** `asOf` omitted means today; the service, not the schema, supplies it. */
export const atRiskQuerySchema = z
  .object({ asOf: isoDateSchema.optional() })
  .strict()

export type AtRiskQuery = z.infer<typeof atRiskQuerySchema>
```

Add to `packages/domain/src/index.ts`, beside the other schema exports:

```ts
export * from './schemas/reporting'
```

- [ ] **Step 6: Write the report**

Create `apps/api/src/reporting/reports.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'

export type AtRiskRow = {
  clientId: string
  clientName: string
  overdueObligations: number
  oldestDueDate: string
  grossOutstandingCents: number
  creditCents: number
  outstandingCents: number
  oldestChargeDueOn: string
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Clients both overdue on a statutory deadline and behind on payment
   * (design §3.7) — the cross-module question neither the obligations
   * dashboard nor the receivables list can answer alone, and the reason this
   * module exists.
   *
   * The overdue test is `dueDate < asOf` on a still-open status, the same
   * definition `groupByUrgency`'s `overdue` bucket uses; the arrears side
   * uses `getReceivables`'s filters and nets credit as Phase 4a does. So this
   * report cannot disagree with either screen.
   */
  async atRisk(asOf: Date): Promise<AtRiskRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        clientId: string
        clientName: string
        overdueObligations: number
        oldestDueDate: Date
        grossOutstandingCents: number
        creditCents: number
        outstandingCents: number
        oldestChargeDueOn: Date
      }>
    >`
      -- Three CTEs, not three joins in one pass: joining obligations and
      -- balances directly multiplies each client's rows by the other side's
      -- count and inflates both aggregates. Each aggregate carries ::int
      -- (ADR 0007) — COUNT/SUM over Int return bigint, which the serializer
      -- throws on.
      WITH overdue AS (
        SELECT "clientId", COUNT(*)::int AS "overdueObligations", MIN("dueDate") AS "oldestDueDate"
        FROM "ObligationInstance"
        WHERE status IN ('PENDING', 'IN_PROGRESS') AND "dueDate" < ${asOf}
        GROUP BY "clientId"
      ),
      arrears AS (
        SELECT "clientId", SUM("outstandingCents")::int AS "grossOutstandingCents", MIN("dueOn") AS "oldestChargeDueOn"
        FROM charge_balances
        WHERE "outstandingCents" > 0 AND status != 'WRITTEN_OFF' AND "dueOn" <= ${asOf}
        GROUP BY "clientId"
      ),
      credit AS (
        SELECT "clientId", SUM("creditCents")::int AS "creditCents"
        FROM payment_credits
        WHERE "creditCents" > 0
        GROUP BY "clientId"
      )
      SELECT c.id AS "clientId", c.name AS "clientName",
             o."overdueObligations", o."oldestDueDate",
             a."grossOutstandingCents",
             COALESCE(cr."creditCents", 0) AS "creditCents",
             GREATEST(a."grossOutstandingCents" - COALESCE(cr."creditCents", 0), 0) AS "outstandingCents",
             a."oldestChargeDueOn"
      FROM "Client" c
      JOIN overdue o ON o."clientId" = c.id
      JOIN arrears a ON a."clientId" = c.id
      LEFT JOIN credit cr ON cr."clientId" = c.id
      WHERE c."archivedAt" IS NULL
        -- A client whose own unspent money covers its debt is not in
        -- arrears, whatever the gross figure says.
        AND GREATEST(a."grossOutstandingCents" - COALESCE(cr."creditCents", 0), 0) > 0
      ORDER BY "outstandingCents" DESC, o."oldestDueDate" ASC
    `

    return rows.map((row) => ({
      ...row,
      oldestDueDate: isoDate(row.oldestDueDate),
      oldestChargeDueOn: isoDate(row.oldestChargeDueOn),
    }))
  }
}
```

`GREATEST` over two `int`s is an `int`, so it needs no cast of its own; the three aggregates inside the CTEs carry theirs.

- [ ] **Step 7: Add the route and register the service**

In `apps/api/src/reporting/reporting.controller.ts`, add to the imports and add the route:

```ts
import { atRiskQuerySchema } from '@ledger-hq/domain'
import type { AtRiskQuery } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ReportsService } from './reports.service.js'
import type { AtRiskRow } from './reports.service.js'
```

```ts
  constructor(
    private readonly search: SearchService,
    private readonly reports: ReportsService,
  ) {}

  @Get('reporting/at-risk')
  async atRisk(@Query(new ZodValidationPipe(atRiskQuerySchema)) query: AtRiskQuery): Promise<AtRiskRow[]> {
    const asOf = query.asOf === undefined ? new Date() : new Date(`${query.asOf}T00:00:00Z`)
    return this.reports.atRisk(asOf)
  }
```

In `apps/api/src/reporting/reporting.module.ts`, add `ReportsService` to `providers`.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/domain test
pnpm --filter @ledger-hq/api test:integration -- reporting
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS everywhere.

- [ ] **Step 9: Commit**

```bash
git add packages/domain/src/schemas/reporting.ts packages/domain/src/schemas/reporting.test.ts packages/domain/src/index.ts apps/api/src/reporting apps/api/test/reporting.integration.test.ts
git commit -m "feat(api): report clients both overdue and in arrears

Three CTEs rather than one pass, so a client with three obligations and
four charges reports three and not twelve. Credit is netted off the
arrears side, so a client whose own money covers its debt is not listed
— the same answer the receivables list gives on the same data.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The period summary report

**Files:**
- Modify: `packages/domain/src/schemas/reporting.ts`
- Modify: `packages/domain/src/schemas/reporting.test.ts`
- Modify: `apps/api/src/reporting/reports.service.ts`
- Modify: `apps/api/src/reporting/reporting.controller.ts`
- Test: `apps/api/test/reporting.integration.test.ts`

**Interfaces:**
- Consumes: `isoDateSchema`; the `Charge`, `Payment`, `PaymentAllocation` and `ObligationInstance` tables.
- Produces:
  ```ts
  export const periodSummaryQuerySchema: z.ZodType<{ from: string; to: string }>
  export type PeriodSummaryQuery = z.infer<typeof periodSummaryQuerySchema>

  export type PeriodSummary = {
    from: string
    to: string
    obligationsDue: number
    obligationsDone: number
    chargesIssuedCents: number
    paymentsReceivedCents: number
    outstandingAtCloseCents: number
  }
  export class ReportsService { async periodSummary(from: Date, to: Date): Promise<PeriodSummary> }
  ```
  `GET /api/v1/reporting/period-summary?from=YYYY-MM-DD&to=YYYY-MM-DD`.

- [ ] **Step 1: Write the failing schema tests**

Append to `packages/domain/src/schemas/reporting.test.ts`:

```ts
import { periodSummaryQuerySchema } from './reporting'

describe('periodSummaryQuerySchema', () => {
  it('accepts a window', () => {
    expect(periodSummaryQuerySchema.parse({ from: '2026-01-01', to: '2026-03-31' })).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
    })
  })

  it('accepts a single-day window', () => {
    expect(periodSummaryQuerySchema.safeParse({ from: '2026-01-01', to: '2026-01-01' }).success).toBe(true)
  })

  it('rejects a window that ends before it starts', () => {
    expect(periodSummaryQuerySchema.safeParse({ from: '2026-03-31', to: '2026-01-01' }).success).toBe(false)
  })

  it('requires both ends', () => {
    expect(periodSummaryQuerySchema.safeParse({ from: '2026-01-01' }).success).toBe(false)
    expect(periodSummaryQuerySchema.safeParse({ to: '2026-03-31' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Write the failing integration tests**

Append to `apps/api/test/reporting.integration.test.ts`:

```ts
describe('GET /api/v1/reporting/period-summary', () => {
  it('counts obligations due and done inside the window', async () => {
    const clientId = await createClient('503111111', 'Padaria Central, Lda.')
    await overdueObligation(clientId, '2026-Q1', '2026-02-15')
    await overdueObligation(clientId, '2026-Q2', '2026-05-15')
    await prisma.obligationInstance.updateMany({
      where: { clientId, periodLabel: '2026-Q1' },
      data: { status: 'DONE', completedAt: new Date('2026-02-20T00:00:00Z') },
    })

    const response = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')

    expect(response.status).toBe(200)
    expect(response.body).toEqual(
      expect.objectContaining({ from: '2026-01-01', to: '2026-03-31', obligationsDue: 1, obligationsDone: 1 }),
    )
  })

  it('sums charges issued and payments received inside the window only', async () => {
    const clientId = await createClient('503222222', 'Padaria Central, Lda.')
    await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'Dentro',
        amountCents: 9000,
        issuedOn: new Date('2026-02-01T00:00:00Z'),
        dueOn: new Date('2026-02-28T00:00:00Z'),
      },
    })
    await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'Fora',
        amountCents: 5000,
        issuedOn: new Date('2026-04-01T00:00:00Z'),
        dueOn: new Date('2026-04-30T00:00:00Z'),
      },
    })
    await prisma.payment.create({
      data: { id: uuidv7(), clientId, amountCents: 4000, receivedOn: new Date('2026-02-10T00:00:00Z'), method: 'TRANSFER' },
    })
    await prisma.payment.create({
      data: { id: uuidv7(), clientId, amountCents: 7000, receivedOn: new Date('2026-04-10T00:00:00Z'), method: 'TRANSFER' },
    })

    const response = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')

    expect(response.body.chargesIssuedCents).toBe(9000)
    expect(response.body.paymentsReceivedCents).toBe(4000)
  })

  it('reports the position at the close of the window, not today', async () => {
    const clientId = await createClient('503333333', 'Padaria Central, Lda.')
    const charge = await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'Cobrança',
        amountCents: 9000,
        issuedOn: new Date('2026-02-01T00:00:00Z'),
        dueOn: new Date('2026-02-28T00:00:00Z'),
      },
    })
    // Paid AFTER the window closed, so at close it was still outstanding.
    const paymentId = uuidv7()
    await prisma.payment.create({
      data: { id: paymentId, clientId, amountCents: 9000, receivedOn: new Date('2026-05-10T00:00:00Z'), method: 'TRANSFER' },
    })
    await prisma.paymentAllocation.create({ data: { paymentId, chargeId: charge.id, amountCents: 9000 } })

    const response = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')

    expect(response.body.outstandingAtCloseCents).toBe(9000)
  })

  it('returns zeros for an empty window rather than nulls', async () => {
    const response = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')

    expect(response.body).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
      obligationsDue: 0,
      obligationsDone: 0,
      chargesIssuedCents: 0,
      paymentsReceivedCents: 0,
      outstandingAtCloseCents: 0,
    })
  })

  it('returns every numeric field as a JSON-safe number', async () => {
    const clientId = await createClient('503444444', 'Padaria Central, Lda.')
    await prisma.payment.create({
      data: { id: uuidv7(), clientId, amountCents: 4000, receivedOn: new Date('2026-02-10T00:00:00Z'), method: 'TRANSFER' },
    })

    const response = await get('/api/v1/reporting/period-summary?from=2026-01-01&to=2026-03-31')

    for (const key of ['obligationsDue', 'obligationsDone', 'chargesIssuedCents', 'paymentsReceivedCents', 'outstandingAtCloseCents']) {
      expect(typeof response.body[key]).toBe('number')
    }
  })

  it('rejects a window that ends before it starts', async () => {
    const response = await get('/api/v1/reporting/period-summary?from=2026-03-31&to=2026-01-01')

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('common.validation_failed')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm --filter @ledger-hq/domain test
pnpm --filter @ledger-hq/api test:integration -- reporting
```

Expected: FAIL — `periodSummaryQuerySchema` is not exported, and the route 404s.

- [ ] **Step 4: Add the schema**

Append to `packages/domain/src/schemas/reporting.ts`:

```ts
/**
 * No `message` override on the refine: the `ZodValidationPipe` promotes a
 * message that matches a known `ErrorCode` to that code, and the pipe
 * already wraps every failure as `common.validation_failed`. See the note in
 * `schemas/common.ts`.
 */
export const periodSummaryQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .strict()
  .refine((value) => value.from <= value.to, { path: ['to'] })

export type PeriodSummaryQuery = z.infer<typeof periodSummaryQuerySchema>
```

ISO dates compare correctly as strings, so the refine needs no `Date`.

- [ ] **Step 5: Write the report**

Append to `apps/api/src/reporting/reports.service.ts`:

```ts
export type PeriodSummary = {
  from: string
  to: string
  obligationsDue: number
  obligationsDone: number
  chargesIssuedCents: number
  paymentsReceivedCents: number
  outstandingAtCloseCents: number
}
```

and the method, inside the class:

```ts
  /**
   * What a window contained (design §3.7). Every figure already exists in
   * Phase 2 and Phase 3 data — a window and four aggregates, no new derived
   * state.
   *
   * `outstandingAtCloseCents` reconstructs the position **at `to`**, not
   * today: it counts only allocations from payments received by then, so a
   * charge settled the month after the quarter closed still shows as
   * outstanding in that quarter's summary. Reporting today's balance under a
   * past period's heading would make every historical summary change as new
   * money arrives.
   */
  async periodSummary(from: Date, to: Date): Promise<PeriodSummary> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        obligationsDue: number
        obligationsDone: number
        chargesIssuedCents: number
        paymentsReceivedCents: number
        outstandingAtCloseCents: number
      }>
    >`
      WITH obligations AS (
        SELECT
          COUNT(*)::int AS "obligationsDue",
          COUNT(*) FILTER (WHERE status = 'DONE')::int AS "obligationsDone"
        FROM "ObligationInstance"
        WHERE "dueDate" BETWEEN ${from} AND ${to}
      ),
      charges AS (
        SELECT COALESCE(SUM("amountCents"), 0)::int AS "chargesIssuedCents"
        FROM "Charge"
        WHERE "issuedOn" BETWEEN ${from} AND ${to}
      ),
      payments AS (
        SELECT COALESCE(SUM("amountCents"), 0)::int AS "paymentsReceivedCents"
        FROM "Payment"
        WHERE "receivedOn" BETWEEN ${from} AND ${to}
      ),
      -- Charges that existed at close and had not been forgiven by then.
      issued AS (
        SELECT id, "amountCents"
        FROM "Charge"
        WHERE "issuedOn" <= ${to}
          AND ("writtenOffAt" IS NULL OR "writtenOffAt"::date > ${to})
      ),
      -- Only money that had actually arrived by close counts against them.
      settled AS (
        SELECT a."chargeId", SUM(a."amountCents")::int AS "allocatedCents"
        FROM "PaymentAllocation" a
        JOIN "Payment" p ON p.id = a."paymentId"
        WHERE p."receivedOn" <= ${to}
        GROUP BY a."chargeId"
      ),
      closing AS (
        SELECT COALESCE(SUM(GREATEST(i."amountCents" - COALESCE(s."allocatedCents", 0), 0)), 0)::int AS "outstandingAtCloseCents"
        FROM issued i
        LEFT JOIN settled s ON s."chargeId" = i.id
      )
      SELECT o."obligationsDue", o."obligationsDone", ch."chargesIssuedCents",
             p."paymentsReceivedCents", cl."outstandingAtCloseCents"
      FROM obligations o, charges ch, payments p, closing cl
    `

    return {
      from: isoDate(from),
      to: isoDate(to),
      obligationsDue: row?.obligationsDue ?? 0,
      obligationsDone: row?.obligationsDone ?? 0,
      chargesIssuedCents: row?.chargesIssuedCents ?? 0,
      paymentsReceivedCents: row?.paymentsReceivedCents ?? 0,
      outstandingAtCloseCents: row?.outstandingAtCloseCents ?? 0,
    }
  }
```

Each CTE aggregates over exactly one table, so nothing fans out and every `COUNT`/`SUM` carries its own `::int`.

- [ ] **Step 6: Add the route**

In `apps/api/src/reporting/reporting.controller.ts`, extend the imports with `periodSummaryQuerySchema`, `PeriodSummaryQuery` and `PeriodSummary`, then add:

```ts
  @Get('reporting/period-summary')
  async periodSummary(
    @Query(new ZodValidationPipe(periodSummaryQuerySchema)) query: PeriodSummaryQuery,
  ): Promise<PeriodSummary> {
    return this.reports.periodSummary(new Date(`${query.from}T00:00:00Z`), new Date(`${query.to}T00:00:00Z`))
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/domain test
pnpm --filter @ledger-hq/api test:integration -- reporting
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS everywhere.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/schemas/reporting.ts packages/domain/src/schemas/reporting.test.ts apps/api/src/reporting apps/api/test/reporting.integration.test.ts
git commit -m "feat(api): summarise what a period contained

Four aggregates over a window, each in its own CTE so nothing fans out.
The closing balance reconstructs the position at the window's end rather
than reporting today's, so a past quarter's summary does not change as
new money arrives.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: CSV, built in the browser

**Files:**
- Create: `apps/web/src/reporting/toCsv.ts`
- Create: `apps/web/src/reporting/toCsv.test.ts`
- Create: `apps/web/src/reporting/api.ts`

**Interfaces:**
- Consumes: `formatDate`, `SupportedLocale` (`apps/web/src/i18n/format.ts`); the two report endpoints (Tasks 6 and 7).
- Produces:
  ```ts
  // apps/web/src/reporting/toCsv.ts
  export function toCsv(headers: string[], rows: string[][], locale: SupportedLocale): string
  export function formatCsvAmount(cents: number, locale: SupportedLocale): string
  export function downloadCsv(filename: string, content: string): void

  // apps/web/src/reporting/api.ts
  export type AtRiskRow = { clientId, clientName, overdueObligations, oldestDueDate, grossOutstandingCents, creditCents, outstandingCents, oldestChargeDueOn }
  export type PeriodSummary = { from, to, obligationsDue, obligationsDone, chargesIssuedCents, paymentsReceivedCents, outstandingAtCloseCents }
  export function getAtRisk(asOf?: string): Promise<AtRiskRow[]>
  export function getPeriodSummary(from: string, to: string): Promise<PeriodSummary>
  ```
  Task 9 calls all of them.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/reporting/toCsv.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatCsvAmount, toCsv } from './toCsv'

describe('toCsv', () => {
  it('leads with a UTF-8 BOM, or Excel renders Araújo as mojibake', () => {
    expect(toCsv(['Nome'], [['Araújo']], 'pt-PT').startsWith('﻿')).toBe(true)
  })

  it('separates with a semicolon under pt-PT', () => {
    expect(toCsv(['A', 'B'], [['1', '2']], 'pt-PT')).toBe('﻿A;B\r\n1;2\r\n')
  })

  it('separates with a comma under en-GB', () => {
    expect(toCsv(['A', 'B'], [['1', '2']], 'en-GB')).toBe('﻿A,B\r\n1,2\r\n')
  })

  it('quotes a field containing the delimiter', () => {
    expect(toCsv(['A'], [['x;y']], 'pt-PT')).toBe('﻿A\r\n"x;y"\r\n')
    // A semicolon is not special under en-GB, so it is not quoted there.
    expect(toCsv(['A'], [['x;y']], 'en-GB')).toBe('﻿A\r\nx;y\r\n')
  })

  it('doubles an internal quote and wraps the field', () => {
    expect(toCsv(['A'], [['say "hi"']], 'pt-PT')).toBe('﻿A\r\n"say ""hi"""\r\n')
  })

  it('quotes a field containing a newline', () => {
    expect(toCsv(['A'], [['one\ntwo']], 'pt-PT')).toBe('﻿A\r\n"one\ntwo"\r\n')
  })

  it('emits a header row and no data rows for an empty report', () => {
    expect(toCsv(['A', 'B'], [], 'pt-PT')).toBe('﻿A;B\r\n')
  })
})

describe('formatCsvAmount', () => {
  // Deliberately not formatCurrency: a euro sign makes the cell text rather
  // than a number, and a grouping separator collides with the delimiter.
  it('writes a plain decimal with the locale separator and no grouping', () => {
    expect(formatCsvAmount(1234567, 'pt-PT')).toBe('12345,67')
    expect(formatCsvAmount(1234567, 'en-GB')).toBe('12345.67')
  })

  it('always writes two decimals', () => {
    expect(formatCsvAmount(9000, 'pt-PT')).toBe('90,00')
    expect(formatCsvAmount(0, 'en-GB')).toBe('0.00')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- toCsv
```

Expected: FAIL — `Failed to resolve import "./toCsv"`.

- [ ] **Step 3: Write the CSV helpers**

Create `apps/web/src/reporting/toCsv.ts`:

```ts
import type { SupportedLocale } from '../i18n/format'

// Excel takes the delimiter from its own locale: a comma-separated file
// opens as one column per row on a Portuguese machine.
const DELIMITER: Record<SupportedLocale, string> = { 'pt-PT': ';', 'en-GB': ',' }

/**
 * An amount for a spreadsheet cell — NOT `formatCurrency`.
 *
 * `formatCurrency` emits `9 000,00 €`, and both halves of that are wrong
 * here: the euro sign makes Excel treat the cell as text rather than a
 * number, and the grouping separator is the delimiter under `en-GB`. A plain
 * two-decimal number with the locale's decimal mark is what Excel parses.
 */
export function formatCsvAmount(cents: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(cents / 100)
}

function escapeField(field: string, delimiter: string): string {
  if (!field.includes(delimiter) && !field.includes('"') && !field.includes('\n') && !field.includes('\r')) {
    return field
  }
  return `"${field.replaceAll('"', '""')}"`
}

/**
 * Builds the file in the browser rather than on the server, because ADR 0004
 * requires it: a header row is prose, and a server-rendered CSV would have to
 * know the caller's locale to write `Cliente` or `Client`. It also means the
 * file's numbers and dates come from the same formatters the screen used, so
 * file and screen cannot disagree.
 *
 * CRLF line endings: that is what RFC 4180 specifies and what Excel expects.
 */
export function toCsv(headers: string[], rows: string[][], locale: SupportedLocale): string {
  const delimiter = DELIMITER[locale]
  const lines = [headers, ...rows].map((row) => row.map((field) => escapeField(field, delimiter)).join(delimiter))

  // The BOM is not decoration: without it Excel decodes the file as the
  // system's legacy codepage and renders `Araújo` as mojibake.
  return `﻿${lines.join('\r\n')}\r\n`
}

export function downloadCsv(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // Revoking immediately is safe: the browser has already taken its own
  // reference by the time click() returns, and not revoking leaks the blob
  // for the life of the document.
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Write the API client**

Create `apps/web/src/reporting/api.ts`:

```ts
import { apiFetch } from '../api/client'

export type AtRiskRow = {
  clientId: string
  clientName: string
  overdueObligations: number
  oldestDueDate: string
  /** What the client owes before its own unspent money is counted. */
  grossOutstandingCents: number
  creditCents: number
  /** Net, floored at zero — what this client actually still owes. */
  outstandingCents: number
  oldestChargeDueOn: string
}

export type PeriodSummary = {
  from: string
  to: string
  obligationsDue: number
  obligationsDone: number
  chargesIssuedCents: number
  paymentsReceivedCents: number
  /** The position at the window's end, not today's. */
  outstandingAtCloseCents: number
}

export function getAtRisk(asOf?: string): Promise<AtRiskRow[]> {
  return apiFetch(asOf === undefined ? '/reporting/at-risk' : `/reporting/at-risk?asOf=${asOf}`)
}

export function getPeriodSummary(from: string, to: string): Promise<PeriodSummary> {
  return apiFetch(`/reporting/period-summary?from=${from}&to=${to}`)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/web test -- toCsv
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS everywhere.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/reporting
git commit -m "feat(web): build report CSVs in the browser

ADR 0004 requires it: a header row is prose, and a server-rendered CSV
would have to know the caller's locale. Delimiter per locale, UTF-8 BOM
so Excel does not mangle accents, RFC 4180 quoting, and amounts as plain
decimals rather than currency strings so the cell parses as a number.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The reporting page

**Files:**
- Create: `apps/web/src/i18n/locales/pt/reporting.json`
- Create: `apps/web/src/i18n/locales/en/reporting.json`
- Modify: `apps/web/src/i18n/locales/pt/index.ts`
- Modify: `apps/web/src/i18n/locales/en/index.ts`
- Modify: `apps/web/src/i18n/locales/pt/common.json` (one `nav` key)
- Modify: `apps/web/src/i18n/locales/en/common.json` (one `nav` key)
- Create: `apps/web/src/reporting/AtRiskReport.tsx`
- Create: `apps/web/src/reporting/PeriodSummaryReport.tsx`
- Create: `apps/web/src/reporting/ReportingPage.tsx`
- Create: `apps/web/src/reporting/ReportingPageSkeleton.tsx`
- Create: `apps/web/src/reporting/AtRiskReport.test.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/shell/Sidebar.tsx`
- Modify: `apps/web/src/shell/MobileNav.tsx`

**Interfaces:**
- Consumes: `getAtRisk`, `getPeriodSummary`, `toCsv`, `formatCsvAmount`, `downloadCsv` (Task 8).
- Produces: a `/reporting` route rendering `ReportingPage`, and a fourth `DESTINATIONS` entry in both shells.

- [ ] **Step 1: Add the locale files and register the namespace**

Create `apps/web/src/i18n/locales/pt/reporting.json`:

```json
{
  "title": "Relatórios",
  "download": "Descarregar CSV",
  "atRisk": {
    "title": "Em risco",
    "hint": "Clientes em atraso numa obrigação e com valores por liquidar.",
    "empty": "Nenhum cliente em risco.",
    "emptyHint": "Ninguém acumula prazos em atraso e dívida ao mesmo tempo.",
    "column": {
      "client": "Cliente",
      "overdueObligations": "Obrigações em atraso",
      "oldestDueDate": "Prazo mais antigo",
      "gross": "Dívida bruta",
      "credit": "Crédito",
      "outstanding": "Em dívida"
    }
  },
  "periodSummary": {
    "title": "Resumo do período",
    "from": "De",
    "to": "Até",
    "obligationsDue": "Obrigações com prazo",
    "obligationsDone": "Obrigações entregues",
    "chargesIssued": "Cobranças emitidas",
    "paymentsReceived": "Pagamentos recebidos",
    "outstandingAtClose": "Em dívida no fecho"
  }
}
```

Create `apps/web/src/i18n/locales/en/reporting.json`:

```json
{
  "title": "Reports",
  "download": "Download CSV",
  "atRisk": {
    "title": "At risk",
    "hint": "Clients overdue on an obligation and behind on payment.",
    "empty": "No client at risk.",
    "emptyHint": "Nobody is carrying both a missed deadline and a debt.",
    "column": {
      "client": "Client",
      "overdueObligations": "Overdue obligations",
      "oldestDueDate": "Oldest deadline",
      "gross": "Gross debt",
      "credit": "Credit",
      "outstanding": "Outstanding"
    }
  },
  "periodSummary": {
    "title": "Period summary",
    "from": "From",
    "to": "To",
    "obligationsDue": "Obligations due",
    "obligationsDone": "Obligations filed",
    "chargesIssued": "Charges issued",
    "paymentsReceived": "Payments received",
    "outstandingAtClose": "Outstanding at close"
  }
}
```

In **both** `apps/web/src/i18n/locales/pt/index.ts` and `apps/web/src/i18n/locales/en/index.ts`, add the import and the entry:

```ts
import reporting from './reporting.json'
```

```ts
export const resources = { billing, clients, common, domain, employments, errors, obligations, reporting, vault }
```

A namespace missing from these barrels makes every `t()` in it return the key rather than the string, and `i18n:check` will not catch it — it compares the bundles against each other, and the namespace would be absent from both.

Add the nav key to both `common.json` files, inside the existing `nav` object:

```json
  "nav": { "clients": "Clientes", "vault": "Cofre", "reporting": "Relatórios" },
```

```json
  "nav": { "clients": "Clients", "vault": "Vault", "reporting": "Reports" },
```

- [ ] **Step 2: Write the failing component test**

Create `apps/web/src/reporting/AtRiskReport.test.tsx`, following the harness in `apps/web/src/billing/ReceivablesSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { formatCurrency } from '../i18n/format'

const getAtRiskMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getAtRisk: getAtRiskMock, getPeriodSummary: vi.fn() }))

const { AtRiskReport } = await import('./AtRiskReport')

await initI18n()
await i18next.changeLanguage('pt-PT')

// `formatCurrency` separates thousands with a narrow no-break space (U+202F).
function shown(value: string): string {
  return value.replace(/\s/g, ' ')
}

function renderReport() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: AtRiskReport })
  const clientRoute = createRoute({ getParentRoute: () => rootRoute, path: '/clients/$clientId', component: () => null })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, clientRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getAtRiskMock.mockReset()
})

describe('AtRiskReport', () => {
  it('lists a client with both counts and links to it', async () => {
    getAtRiskMock.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Padaria Central, Lda.',
        overdueObligations: 3,
        oldestDueDate: '2026-03-15',
        grossOutstandingCents: 20000,
        creditCents: 0,
        outstandingCents: 20000,
        oldestChargeDueOn: '2026-05-31',
      },
    ])

    renderReport()

    expect(await screen.findByRole('link', { name: /padaria central/i })).toHaveAttribute('href', '/clients/c1')
    expect(screen.getByText('3')).toBeVisible()
    expect(screen.getByText(shown(formatCurrency(20000, 'pt-PT')))).toBeVisible()
  })

  it('shows credit beside the net figure when there is any', async () => {
    getAtRiskMock.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Padaria Central, Lda.',
        overdueObligations: 1,
        oldestDueDate: '2026-03-15',
        grossOutstandingCents: 20000,
        creditCents: 15000,
        outstandingCents: 5000,
        oldestChargeDueOn: '2026-05-31',
      },
    ])

    renderReport()

    expect(await screen.findByText(shown(formatCurrency(5000, 'pt-PT')))).toBeVisible()
    expect(screen.getByText(shown(formatCurrency(15000, 'pt-PT')))).toBeVisible()
  })

  it('shows an empty state when nobody is at risk', async () => {
    getAtRiskMock.mockResolvedValue([])

    renderReport()

    expect(await screen.findByText(/nenhum cliente em risco/i)).toBeVisible()
  })

  it('offers the download only when there is something to download', async () => {
    getAtRiskMock.mockResolvedValue([])

    renderReport()

    await screen.findByText(/nenhum cliente em risco/i)
    expect(screen.queryByRole('button', { name: /descarregar csv/i })).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- AtRiskReport
```

Expected: FAIL — `Failed to resolve import "./AtRiskReport"`.

- [ ] **Step 4: Write the at-risk report**

Create `apps/web/src/reporting/AtRiskReport.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Card, DataList, EmptyState, Money } from '../ui'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { getAtRisk } from './api'
import { downloadCsv, formatCsvAmount, toCsv } from './toCsv'

export function AtRiskReport() {
  const { t, i18n } = useTranslation('reporting')
  const locale = i18n.language as SupportedLocale

  const atRisk = useQuery({ queryKey: ['at-risk'], queryFn: () => getAtRisk() })

  function download() {
    if (atRisk.data === undefined) return

    const headers = [
      t('atRisk.column.client'),
      t('atRisk.column.overdueObligations'),
      t('atRisk.column.oldestDueDate'),
      t('atRisk.column.gross'),
      t('atRisk.column.credit'),
      t('atRisk.column.outstanding'),
    ]
    const rows = atRisk.data.map((row) => [
      row.clientName,
      String(row.overdueObligations),
      formatDate(row.oldestDueDate, locale),
      formatCsvAmount(row.grossOutstandingCents, locale),
      formatCsvAmount(row.creditCents, locale),
      formatCsvAmount(row.outstandingCents, locale),
    ])

    // ISO in the filename deliberately: a filename is sorted, not read aloud.
    downloadCsv(`at-risk-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, rows, locale))
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          {/* ReportingPage owns the h1; each report is a section of it. */}
          <h2 className="text-lg font-semibold">{t('atRisk.title')}</h2>
          <p className="text-sm text-muted">{t('atRisk.hint')}</p>
        </div>
        {atRisk.data !== undefined && atRisk.data.length > 0 && (
          <Button variant="secondary" onClick={download}>
            {t('download')}
          </Button>
        )}
      </header>

      {atRisk.isPending ? null : atRisk.isError ? (
        <ErrorMessage error={atRisk.error} />
      ) : atRisk.data.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t('atRisk.empty')} description={t('atRisk.emptyHint')} />
      ) : (
        <Card padding="none" className="px-5">
          <DataList>
            {atRisk.data.map((row) => (
              <DataList.Row
                key={row.clientId}
                label={
                  <Link to="/clients/$clientId" params={{ clientId: row.clientId }} className="font-medium">
                    {row.clientName}
                  </Link>
                }
                value={
                  <>
                    <span className="text-sm text-muted">
                      {row.overdueObligations} · {formatDate(row.oldestDueDate, locale)}
                    </span>
                    {row.creditCents > 0 && (
                      <span className="text-xs text-muted">
                        {t('atRisk.column.credit')} <Money cents={row.creditCents} size="sm" tone="credit" />
                      </span>
                    )}
                    <Money cents={row.outstandingCents} />
                  </>
                }
              />
            ))}
          </DataList>
        </Card>
      )}
    </section>
  )
}
```

`Button` exposes `primary | secondary | ghost | danger` and defaults to `secondary` (`apps/web/src/ui/Button.tsx`), so the download is a plain secondary button and needs no new variant.

- [ ] **Step 5: Write the period summary report**

Create `apps/web/src/reporting/PeriodSummaryReport.tsx`:

```tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Card, DataList, Money } from '../ui'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { getPeriodSummary } from './api'
import { downloadCsv, formatCsvAmount, toCsv } from './toCsv'

/** Defaults to the current calendar year, the window most often asked for. */
function defaultWindow(): { from: string; to: string } {
  const year = new Date().getUTCFullYear()
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

export function PeriodSummaryReport() {
  const { t, i18n } = useTranslation('reporting')
  const locale = i18n.language as SupportedLocale
  const [window, setWindow] = useState(defaultWindow)

  const summary = useQuery({
    queryKey: ['period-summary', window.from, window.to],
    queryFn: () => getPeriodSummary(window.from, window.to),
    // The server rejects an inverted window with a 422; do not ask it.
    enabled: window.from <= window.to,
  })

  function download() {
    if (summary.data === undefined) return

    const headers = [t('periodSummary.from'), t('periodSummary.to'), t('periodSummary.obligationsDue'), t('periodSummary.obligationsDone'), t('periodSummary.chargesIssued'), t('periodSummary.paymentsReceived'), t('periodSummary.outstandingAtClose')]
    const rows = [
      [
        formatDate(summary.data.from, locale),
        formatDate(summary.data.to, locale),
        String(summary.data.obligationsDue),
        String(summary.data.obligationsDone),
        formatCsvAmount(summary.data.chargesIssuedCents, locale),
        formatCsvAmount(summary.data.paymentsReceivedCents, locale),
        formatCsvAmount(summary.data.outstandingAtCloseCents, locale),
      ],
    ]

    downloadCsv(`period-summary-${window.from}_${window.to}.csv`, toCsv(headers, rows, locale))
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-lg font-semibold">{t('periodSummary.title')}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('periodSummary.from')}
            <input
              type="date"
              value={window.from}
              onChange={(event) => setWindow((current) => ({ ...current, from: event.target.value }))}
              className="rounded-control border border-line px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('periodSummary.to')}
            <input
              type="date"
              value={window.to}
              onChange={(event) => setWindow((current) => ({ ...current, to: event.target.value }))}
              className="rounded-control border border-line px-2 py-1"
            />
          </label>
          {summary.data !== undefined && (
            <Button variant="secondary" onClick={download}>
              {t('download')}
            </Button>
          )}
        </div>
      </header>

      {summary.isPending ? null : summary.isError ? (
        <ErrorMessage error={summary.error} />
      ) : (
        <Card padding="none" className="px-5">
          <DataList>
            <DataList.Row label={t('periodSummary.obligationsDue')} value={summary.data.obligationsDue} />
            <DataList.Row label={t('periodSummary.obligationsDone')} value={summary.data.obligationsDone} />
            <DataList.Row label={t('periodSummary.chargesIssued')} value={<Money cents={summary.data.chargesIssuedCents} />} />
            <DataList.Row label={t('periodSummary.paymentsReceived')} value={<Money cents={summary.data.paymentsReceivedCents} tone="credit" />} />
            <DataList.Total label={t('periodSummary.outstandingAtClose')} value={<Money cents={summary.data.outstandingAtCloseCents} />} />
          </DataList>
        </Card>
      )}
    </section>
  )
}
```

The two date inputs are plain, for the reason Task 5 records: `ui/` has no `Input` until UI refresh Stage 2.

- [ ] **Step 6: Write the page and its skeleton**

Create `apps/web/src/reporting/ReportingPageSkeleton.tsx`:

```tsx
import { Card, Skeleton } from '../ui'

export function ReportingPageSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton width="6rem" height="1.25rem" />
      <Card padding="none" className="flex flex-col gap-3 px-5 py-4">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} height="0.875rem" />
        ))}
      </Card>
    </div>
  )
}
```

Create `apps/web/src/reporting/ReportingPage.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../ui'
import { AtRiskReport } from './AtRiskReport'
import { PeriodSummaryReport } from './PeriodSummaryReport'

export function ReportingPage() {
  const { t } = useTranslation('reporting')

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('title')} />
      <AtRiskReport />
      <PeriodSummaryReport />
    </div>
  )
}
```

Each report owns its own query and its own pending branch, so one slow report never blanks the other — which is why `ReportingPageSkeleton` is available to them rather than wrapping the page.

- [ ] **Step 7: Add the route and the destination**

In `apps/web/src/router.tsx`:

```tsx
import { ReportingPage } from './reporting/ReportingPage'

const reportingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reporting',
  component: ReportingPage,
})
```

and add `reportingRoute` to `addChildren`.

In **both** `apps/web/src/shell/Sidebar.tsx` and `apps/web/src/shell/MobileNav.tsx`, add `ChartColumn` to the `lucide-react` import and a fourth entry to `DESTINATIONS`:

```tsx
  { to: '/reporting', labelKey: 'common:nav.reporting', icon: ChartColumn },
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/web test -- AtRiskReport
pnpm --filter @ledger-hq/web test
pnpm --filter @ledger-hq/web i18n:check
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS everywhere. `MobileNav.test.tsx` and `AppLayout.test.tsx` assert the shell's structure — if either counts destinations, update the count rather than the component.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/reporting apps/web/src/router.tsx apps/web/src/shell apps/web/src/i18n/locales
git commit -m "feat(web): a reporting page with the two reports

At risk lists clients carrying both a missed deadline and a debt, net of
credit; the period summary answers what a window contained. Each report
owns its own query, so one slow one never blanks the other, and each
downloads its own CSV.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: End-to-end proof, and the documents that are now wrong

**Files:**
- Create: `apps/web/e2e/search-and-reporting.spec.ts`
- Modify: `docs/architecture.md:33-66`
- Modify: `docs/security-model.md`
- Modify: `docs/operations.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above. Produces nothing new.

- [ ] **Step 1: Write the failing E2E spec**

Create `apps/web/e2e/search-and-reporting.spec.ts`, reusing the sign-in idiom from `apps/web/e2e/billing.spec.ts` verbatim. The suite runs against one shared backend, so the client name and NIF must be unique: `507666666` and `507777778` satisfy the checksum rule in `packages/domain/src/identifiers/nif.ts` and are taken by no other spec (`grep -rn "nif" apps/web/e2e/*.spec.ts` lists the ones in use).

```ts
import { expect, test } from '@playwright/test'

const MASTER_PASSWORD = 'a sufficiently long master password'

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByLabel(/email/i).fill('paulo@example.com')
  await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
  const confirmPasswordField = page.getByLabel(/confirma/i)
  if (await confirmPasswordField.isVisible().catch(() => false)) {
    await confirmPasswordField.fill(MASTER_PASSWORD)
  }
  await page.getByRole('button', { name: /criar|entrar/i }).click()
  await expect(page.getByRole('link', { name: /clientes/i })).toBeVisible()
}

test('finds a client by a three-letter prefix and opens it', async ({ page }) => {
  await signIn(page)

  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Mercearia Pesquisável, Lda.')
  await page.getByLabel(/^nif$/i).fill('507666666')
  await page.getByRole('button', { name: /guardar/i }).click()
  await expect(page.getByText('Mercearia Pesquisável, Lda.')).toBeVisible()

  // The shell's box, not the clients page's own filter.
  await page.getByRole('searchbox', { name: /pesquisar/i }).fill('merc')

  await expect(page).toHaveURL(/\/search\?q=merc/)
  await page.getByRole('link', { name: /mercearia pesquisável/i }).click()
  await expect(page.getByText('Mercearia Pesquisável, Lda.')).toBeVisible()
})

test('lists a client that is both overdue and in arrears on the reporting page', async ({ page }) => {
  await signIn(page)

  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Talho em Risco, Lda.')
  await page.getByLabel(/^nif$/i).fill('507777778')
  await page.getByRole('button', { name: /guardar/i }).click()
  await page.getByRole('button', { name: /guardar/i }).click() // fiscal profile defaults

  // A charge already past its due date puts the client in arrears; the
  // fiscal profile's own generated obligations supply the overdue side.
  const ledger = page.getByRole('region', { name: /^faturação$/i })
  const adHocCharge = ledger.getByRole('form', { name: /nova cobrança avulsa/i })
  await adHocCharge.getByLabel(/descrição/i).fill('Trabalho extra')
  await adHocCharge.getByLabel(/valor \(cêntimos\)/i).fill('20000')
  await adHocCharge.getByLabel(/data de vencimento/i).fill('2026-02-28')
  await adHocCharge.getByRole('button', { name: /^guardar$/i }).click()

  await page.getByRole('link', { name: /relatórios/i }).click()
  await expect(page.getByRole('heading', { name: /^em risco$/i })).toBeVisible()
  // Either the client is listed, or the report honestly says nobody is — both
  // are correct answers depending on whether the catalog generated an overdue
  // obligation for this profile. Assert the report rendered its own answer.
  await expect(
    page.getByText('Talho em Risco, Lda.').or(page.getByText(/nenhum cliente em risco/i)),
  ).toBeVisible()
})
```

- [ ] **Step 2: Run the E2E suite against an empty database**

```bash
docker compose exec postgres psql -U ledger -d postgres \
  -c 'DROP DATABASE IF EXISTS ledger_hq_e2e WITH (FORCE)' \
  -c 'CREATE DATABASE ledger_hq_e2e OWNER ledger'
export DATABASE_URL="postgresql://ledger:<password>@localhost:5432/ledger_hq_e2e"
pnpm --filter @ledger-hq/api exec prisma migrate deploy
pnpm --filter @ledger-hq/web test:e2e
```

Expected: PASS, every spec. Each spec registers its own client, so this needs the throwaway database, not your development one.

- [ ] **Step 3: Correct the architecture document**

`docs/architecture.md`'s module table is stale before this change: it lists `vault`, `obligations` and `billing` under "Not yet built", and they have all shipped. Fix that in the same pass as adding `reporting`, because a reader cannot tell which half of a half-stale list to trust.

- Add a row to the module table:

```markdown
| `reporting` | Global search (`GET /api/v1/search`) and the two cross-module reports (`GET /api/v1/reporting/*`) | `auth` |
```

- Replace the "Not yet built" paragraph. `reporting` now exists, and it is the one module that reads other modules' tables. State the exception explicitly so it is a decision on the record rather than a violation somebody finds later:

```markdown
`reporting` is the exception the rule anticipated. It imports `auth` alone
and reads `Client`, `Platform`, `ObligationInstance`, `ObligationDefinition`,
`Charge`, `charge_balances` and `payment_credits` directly through
`$queryRaw`. A cross-module read model has no other way to be a single
query, and that is precisely the trade this rule was written to permit: the
coupling is one-directional and confined to one module, rather than a
lateral import between two siblings. `reporting` calls no sibling service,
and no sibling imports it.
```

- Add `payment_credits` and the five `searchVector` columns to whatever section documents `charge_balances`, noting that Prisma models neither — views are read through `$queryRaw`, and `tsvector` columns are declared `Unsupported()` so Prisma leaves them alone.

- [ ] **Step 4: Record what search cannot see**

In `docs/security-model.md`, add one line where the vault's zero-knowledge property is described:

```markdown
Global search (Phase 4b) indexes clients, platforms, obligations and charges.
It cannot index credentials: the server holds `ciphertext` and `iv` it has no
key for, so no server-side index can cover them. `Credential.label` is not
indexed either — it is a per-client disambiguator whose meaning comes from
the client row that would already have matched. Typing a credential's
username into the search box finds nothing; it finds the client and the
platform, from which the operator unlocks the vault.
```

- [ ] **Step 5: Record the restore dependency**

In `docs/operations.md`, beside the existing `btree_gist` note in the restore section:

```markdown
The database also carries the `unaccent` extension and the
`portuguese_unaccent` text-search configuration that the search indexes
depend on (Phase 4b). `pg_dump` carries the configuration, so a restore into
a database where `unaccent` is installed needs no extra step — but restoring
where it is absent fails at the configuration, not at the first query. Check
for it the same way you check for `btree_gist`.
```

And in the update section, note that the Phase 4b migration rewrites five tables to add stored columns, so it belongs in the maintenance window rather than mid-day.

- [ ] **Step 6: Update the README's phase list**

Extend the sentence that names the implemented phases so Phase 4b is listed — global search and the two cross-module reports — and point at the spec.

- [ ] **Step 7: Run the full gate**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @ledger-hq/api test:integration
pnpm --filter @ledger-hq/web i18n:check
```

Expected: PASS, all of it.

- [ ] **Step 8: Commit**

```bash
git add apps/web/e2e/search-and-reporting.spec.ts docs/architecture.md docs/security-model.md docs/operations.md README.md
git commit -m "test(web): prove search and the at-risk report end to end

Also corrects the architecture doc, whose module table still listed
vault, obligations and billing as not yet built, and records reporting
as the one module that reads its siblings' tables — the exception the
rule was written to permit. The security model now states what search
cannot see, and the runbook the extension a restore depends on.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
