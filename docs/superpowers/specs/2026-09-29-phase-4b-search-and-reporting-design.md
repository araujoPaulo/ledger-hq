# Phase 4b — Search and Reporting Design

- **Date:** 2026-09-29
- **Status:** Approved
- **Author:** Design session with the product owner

## 1. Context

Phase 4 decomposes into three sub-phases (Phase 4a spec, §2): 4a client
credit, 4b search and reporting, 4c obligation attachments. This document
specifies the second.

The master spec names "cross-module reporting, global search" in Phase 4's
one table row (§14) and nothing more. Two of the four pains the design
session recorded land here: *finding things* — the operator knows a name, a
tax number or a platform and has to walk into a module to reach it — and *no
cross-module view* — nothing answers "which clients are both late on a
deadline and behind on payment", because obligations and billing are read
through separate screens that never meet.

`docs/architecture.md` already reserves the place both belong. Its module
table lists `reporting` under "Not yet built", with the rule that makes it
necessary: `clients` is the core, `vault`/`obligations`/`billing` never
import from one another, and **a view that needs data from two of them
belongs in `reporting`**. Search reads four modules' tables and reporting
reads three, so both live there and neither adds a lateral import anywhere.

## 2. Scope

In scope: one `reporting` module on the API; Postgres full-text search over
clients, platforms, obligations and charges, with a search box in the app
shell and its own results route; two cross-module reports with on-screen
views; a CSV download for each report.

Out of scope: searching credential secrets (§3.1 — impossible by
construction, not deferred); saved or scheduled reports; charts; PDF output;
search over attachments (4c has no files yet); everything in 4a and 4c; and
"ergonomics" as a catch-all — the master spec's third Phase 4 word is not a
deliverable and this document does not invent one.

## 3. Decisions

### 3.1 What search can and cannot see

The vault is zero-knowledge (master spec §9): `CredentialVersion` holds
`ciphertext` and `iv` as `Bytes` and the server has no key for either. No
server-side index can cover them, and nothing here tries.

Concretely, typing a credential's username into the search box finds
**nothing**. What it finds is the plaintext metadata around it — the
client's name and tax number, the platform's name — from which the operator
opens the client and unlocks the credentials section. `Credential.label` is
not indexed either: it is a per-client disambiguator ("gerente", "sócio B"),
unique only within `[clientId, platformId, label]`, so it carries no meaning
away from the client row that would already have matched. This is a property
of the design, not a gap to close later, and it belongs as one line in
`docs/security-model.md`.

### 3.2 Postgres full-text, with a configuration that unaccents

A generated `tsvector` column per searchable table, a GIN index on each,
ranked results. No new service, no new container, no new runtime dependency,
and the index is backed up and restored by the existing nightly `pg_dump`
because it is part of the database.

Accents need one piece of care. `unaccent()` is not `IMMUTABLE` (it reads a
dictionary file), so it cannot appear in a generated column's expression.
The supported way round is a text-search configuration putting `unaccent` in
front of the Portuguese stemmer, which *is* immutable when named by a
`regconfig` literal:

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TEXT SEARCH CONFIGURATION portuguese_unaccent (COPY = portuguese);
ALTER TEXT SEARCH CONFIGURATION portuguese_unaccent
  ALTER MAPPING FOR hword, hword_part, word
  WITH unaccent, portuguese_stem;
```

`unaccent` ships in `postgres-contrib`, which the `postgres:18.6-alpine`
image in `docker-compose.yml` already carries. Same one-time migration step
`btree_gist` was in Phase 0 and Phase 3: write it at the top of the
migration, and confirm the extension is available on the production instance
before the migration depends on it (Phase 3 spec §7 made the same note).

### 3.3 What feeds each vector, and with what weight

`A` is what someone types when they mean to find *this* record; `B` is a
secondary handle; `C` is prose that should match but never outrank a name.

| Table | A | B | C |
|---|---|---|---|
| `Client` | `name`, `taxId` | `email`, `phone`, `socialSecurityNo` | `notes` |
| `Platform` | `name` | `url` | — |
| `ObligationDefinition` | `code`, `name` | `legalRef` | — |
| `ObligationInstance` | `periodLabel` | `reference` | `notes` |
| `Charge` | `description` | `periodLabel` | `writeOffReason` |

The two obligation tables carry separate vectors because a generated column
can only reference its own row: the readable name lives on
`ObligationDefinition` (synced from the fiscal catalog by
`syncCatalogDefinitions`), the period and reference on the instance. The
obligations branch matches either vector across the join the two already
have. `Client` is the shape they all follow:

```sql
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
```

Generated, not trigger-maintained: Postgres recomputes the column on every
write of its inputs, so it cannot drift the way a trigger nobody updated for
a new column would.

### 3.4 Prefix matching, and the query the API builds

The operator types three letters and expects the client. `plainto_tsquery`
has no prefix operator and `websearch_to_tsquery` does not expose one, so
the query is assembled: split on whitespace, strip each term of everything
outside `[\p{L}\p{N}]`, join the survivors with `&`, give the last one `:*`.

```ts
// packages/domain/src/search/query.ts
export function toTsQuery(input: string): string | null
// "mari lda" -> "mari & lda:*"   "501 234" -> "501 & 234:*"   "!!!" -> null
```

It lives in `packages/domain` for the reason `proposeAllocation` does: pure,
and one function defines the query language for the server that runs it and
the tests that assert on it. `null` means nothing searchable was typed, and
the endpoint answers empty rather than erroring — an operator holding down
backspace is not a validation failure.

Ranking is `ts_rank_cd` with the default weights plus a fixed per-type
tiebreak, so a client outranks a charge that scores the same: each branch
selects a literal `typeRank` (`1` client, `2` platform, `3` obligation, `4`
charge) and the outer `ORDER BY` reads `rank DESC, "typeRank" ASC, label
ASC`.

### 3.5 One endpoint, one flat ranked list

```
GET /api/v1/search?q=<text>
```

```ts
export type SearchHit = {
  type: 'client' | 'platform' | 'obligation' | 'charge'
  id: string
  label: string          // the row's own name or description
  context: string | null // the owning client, for an obligation or a charge
  href: string           // the app route that opens it
  rank: number
}
```

Validated by `searchQuerySchema` (`packages/domain/src/schemas/search.ts`),
`z.object({ q: z.string().trim().max(200) }).strict()`. A `q` that
`toTsQuery` reduces to `null` returns `[]` with a `200` — no new
`ErrorCode`, because there is no failure to name, and ADR 0004 forbids
inventing prose, not codes for non-errors.

The four branches are one `UNION ALL` in a single `$queryRaw`, capped at
**10 rows per type and 25 overall**, with the caps in the SQL so a broad term
never drags four tables into the API process. Archived clients are excluded,
matching `ClientsService.list`'s default; written-off charges are included,
because looking one up is a legitimate reason to search.

Prisma models no `tsvector`, so each column is declared
`searchVector Unsupported("tsvector")?` in `schema.prisma` — enough for
Prisma to leave it alone — and every read goes through `$queryRaw` with an
explicit row type, as `charge_balances` is read today. No aggregate appears
here, so ADR 0007's `::int` rule has nothing to bite on; §3.7 is where it
does.

`ClientsService.list`'s own `search` filter (`contains`, `mode:
'insensitive'`) stays: it filters a list the operator is already looking at,
and folding one into the other would make the clients page depend on
`reporting`.

### 3.6 Where search lives in the shell

- **Desktop:** a search box in `Sidebar`, between the wordmark and
  `DESTINATIONS`. The only input in the shell, so it owns the `/` shortcut —
  `/` outside a text field focuses it, `Escape` blurs and clears.
- **Mobile:** no room in `MobileTopBar` beside the mark, connection status
  and account menu, so an icon-only button (`Search` from `lucide-react`,
  `aria-label` from `common:search.label`) navigates to the results route
  with the box focused.
- **Results:** a new `/search` route in `router.tsx` rendering
  `SearchResultsPage`, query in the URL (`?q=`) so a result list is linkable
  and survives a reload. Typing debounces 200 ms and *replaces* the URL — no
  history entry per keystroke.
- **Rendering:** grouped by `type` under an `<h2>` each, as `Card
  padding="none"` + `DataList` rows whose label is a `Link` to `hit.href` —
  the composition `ReceivablesSection` already uses. Nothing found is an
  `EmptyState`; a pending query is a `SearchResultsSkeleton` sibling file
  (`docs/design/guidelines.md` §2).

**Sequencing note.** The search box is a text input and `apps/web/src/ui/`
has no `Input` yet — `docs/design/roadmap.md` introduces
`Input`/`Select`/`Checkbox` in UI refresh **Stage 2**. Either Stage 2 lands
first and 4b consumes `Input`, or 4b ships a plain styled `<input>` in the
shell and Stage 2 adopts it. The plan picks based on what is merged then.

### 3.7 Two reports, and no more

**Report 1 — At risk.** The cross-module question the owner named: clients
both overdue on a statutory deadline and in arrears. Neither the obligations
dashboard nor the receivables list can answer it alone, which is why
`reporting` exists.

```sql
WITH overdue AS (
  SELECT "clientId", COUNT(*)::int AS "overdueObligations", MIN("dueDate") AS "oldestDueDate"
  FROM "ObligationInstance"
  WHERE status IN ('PENDING', 'IN_PROGRESS') AND "dueDate" < $1
  GROUP BY "clientId"
),
arrears AS (
  SELECT "clientId", SUM("outstandingCents")::int AS "outstandingCents", MIN("dueOn") AS "oldestChargeDueOn"
  FROM charge_balances
  WHERE "outstandingCents" > 0 AND status != 'WRITTEN_OFF' AND "dueOn" <= $1
  GROUP BY "clientId"
)
SELECT c.id AS "clientId", c.name AS "clientName",
       o."overdueObligations", o."oldestDueDate",
       a."outstandingCents", a."oldestChargeDueOn"
FROM "Client" c
JOIN overdue o ON o."clientId" = c.id
JOIN arrears a ON a."clientId" = c.id
WHERE c."archivedAt" IS NULL
ORDER BY a."outstandingCents" DESC, o."oldestDueDate" ASC
```

Two CTEs rather than two joins in one pass: joining obligations and balances
directly multiplies each client's rows by the other side's count and inflates
both aggregates. Each aggregate carries `::int` (ADR 0007) — `COUNT`/`SUM`
over `Int` return `bigint`, which the Nest serializer throws on. The overdue
test is `dueDate < asOf` on a still-open status, the definition
`groupByUrgency`'s `overdue` bucket uses
(`packages/domain/src/obligations/group-by-urgency.ts`); the arrears side
uses `getReceivables`'s filters. So this report cannot disagree with either
screen.

**Open question, not settled here:** `getReceivables` has no `archivedAt`
filter at all, while this report's `overdue` CTE excludes archived clients.
An archived client still carrying debt can therefore appear on the
receivables screen but never on this one. Whole-branch review named this
divergence explicitly and ruled it stays as-is for now: whether an archived
client's debt belongs on the main receivables screen is a question for the
practice, not something to settle silently at the end of a phase, and
hiding real debt from that screen would be the worse mistake in the
meantime.

**When 4a lands, this report reads the net figure.** 4a nets unconsumed
credit into `getReceivables` (4a spec §4.4); a client whose credit covers its
debt is not in arrears and must not be listed. Whichever of 4a and 4b lands
second owns making the two agree.

**Report 2 — Period summary.** What a month, quarter or year contained, from
Phase 2 and Phase 3 data. Every figure already exists — a window and four
aggregates, no new derived state.

```ts
export type PeriodSummary = {
  from: string; to: string
  obligationsDue: number; obligationsDone: number
  chargesIssuedCents: number; paymentsReceivedCents: number
  outstandingAtCloseCents: number
  unappliedCreditAtCloseCents: number
}
```

**`outstandingAtCloseCents` answers a different question from the
receivables screen and the at-risk report, deliberately.** It is gross of
credit, counts every client including archived ones, and includes charges
not yet due at `to` — none of which the net, due-only, active-clients-only
figures on the other two screens do. An operator comparing this total
against receivables for a window ending today will see them disagree for
every client holding unspent credit, which is exactly the state Phase 4a
exists to create. `unappliedCreditAtCloseCents` — unspent payment money at
the same instant, by the same "as it stood at `to`" rule — exists so that
disagreement is explainable rather than silent: it does not make the two
figures reconcile exactly (receivables also excludes charges not yet due),
but it is the bridge that lets an operator get from one number to the
other instead of just noticing they differ.

Two reports. Not a reporting framework, not a query builder, not a
saved-query store: two questions that are actually asked, one query each. A
third report is a change to this document, not an afternoon in a generic
engine.

```
GET /api/v1/reporting/at-risk?asOf=YYYY-MM-DD
GET /api/v1/reporting/period-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
```

Validated by schemas in `packages/domain/src/schemas/reporting.ts` built on
the existing `isoDateSchema` (`packages/domain/src/schemas/common.ts`);
`asOf` defaults to today, `from`/`to` are required, and `to` before `from`
fails as `common.validation_failed` through the Zod error map that already
produces codes rather than sentences.

Both live behind a new `/reporting` destination rendering `ReportingPage`
with the two reports stacked — a fourth entry in `DESTINATIONS` in both
`Sidebar` and `MobileNav`, keyed `common:nav.reporting`, icon `ChartColumn`
from `lucide-react`.

### 3.8 CSV is built in the browser, not served by the API

The API returns JSON and the page turns it into a file. Not a convenience —
ADR 0004 requires it. A CSV's header row is prose, and prose is the
frontend's job; a server-rendered CSV would have to know the caller's locale
to write `Cliente` or `Client`, exactly the coupling that ADR forbids.
Building it in the browser also means the file's numbers and dates come from
the same `formatCurrency`/`formatDate` the screen used, so file and screen
cannot disagree.

```ts
// apps/web/src/reporting/toCsv.ts
export function toCsv(headers: string[], rows: string[][], locale: SupportedLocale): string
```

- **Delimiter** `;` for `pt-PT`, `,` for `en-GB`. Excel takes the delimiter
  from its own locale; a comma-separated file opens as one column per row on
  a Portuguese machine.
- **Numbers** carry `formatCurrency`'s separators for the locale (decimal
  comma under `pt-PT`), which makes the cell a number in Excel, not text.
- **Dates** are `formatDate`'s `dd/mm/yyyy`, both locales.
- **A UTF-8 BOM** (`﻿`) leads the file, or Excel renders `Araújo` as
  mojibake.
- A field containing the delimiter, a quote or a newline is double-quoted,
  internal quotes doubled.

Download is a `Blob` + `URL.createObjectURL` + a synthesized `<a download>`;
filenames `at-risk-2026-09-29.csv` and
`period-summary-2026-01-01_2026-03-31.csv` — ISO dates there deliberately,
because a filename is sorted, not read aloud. Header strings are i18n keys in
a new `reporting` namespace, pt-PT and en-GB both, covered by the existing
`pnpm --filter @ledger-hq/web i18n:check` gate.

## 4. Data model

No new tables. One migration: `CREATE EXTENSION IF NOT EXISTS unaccent` plus
the `portuguese_unaccent` configuration (§3.2) at the top, before anything
depends on them; then five generated `tsvector` columns — `Client`,
`Platform`, `ObligationDefinition`, `ObligationInstance`, `Charge` — each
with its GIN index (§3.3), each declared `Unsupported("tsvector")?` in
`schema.prisma` so Prisma leaves it alone (§3.5).

Adding a stored column rewrites all five tables. At this database's size that
is seconds, but it is still a rewrite and belongs in the maintenance window
`docs/operations.md` describes for an update, not mid-day.

## 5. Module layout

```
packages/domain/src/
  search/query.ts          toTsQuery — pure, shared by API and tests
  schemas/search.ts        searchQuerySchema
  schemas/reporting.ts     atRiskQuerySchema, periodSummaryQuerySchema

apps/api/src/reporting/
  reporting.module.ts      imports auth only; no lateral module imports
  reporting.controller.ts  GET /search, GET /reporting/at-risk,
                           GET /reporting/period-summary
  search.service.ts        the UNION ALL query and its row mapping
  reports.service.ts       the two report queries

apps/web/src/
  shell/Sidebar.tsx        search box + the /reporting destination
  shell/MobileNav.tsx      search button + the /reporting destination
  search/SearchBox.tsx     the input, its debounce, the "/" shortcut
  search/SearchResultsPage.tsx
  search/SearchResultsSkeleton.tsx
  search/api.ts            getSearchResults
  reporting/ReportingPage.tsx
  reporting/AtRiskReport.tsx
  reporting/PeriodSummaryReport.tsx
  reporting/toCsv.ts       delimiter, BOM, quoting (§3.8)
  reporting/api.ts         getAtRisk, getPeriodSummary
```

`reporting.module.ts` imports `auth` for `SessionGuard` and nothing else. It
reads other modules' tables through `$queryRaw`, the one deliberate exception
to "no module reaches into another module's Prisma models": a cross-module
read model has no other way to be a single query, and that is the trade
`docs/architecture.md` accepted when it named the module. It calls no sibling
service and no sibling imports it.

## 6. Testing

- **`toTsQuery` unit** (`packages/domain/src/search/query.test.ts`): a single
  term gets `:*`; several terms are `&`-joined with only the last prefixed;
  punctuation-only and empty input return `null`; a term containing `'` or
  `\` produces a query Postgres accepts — asserted against the real parser in
  the integration test, not by eyeballing the string.
- **`search.service` integration** (Testcontainers, the pattern
  `apps/api/test/billing.integration.test.ts` set): `Marisa` found by `mari`;
  `Araújo` found by `araujo` and `Araujo` by `araújo`; a tax number found by
  its first digits; an archived client not returned; **a credential's
  plaintext never returned by any query** (the assertion pinning §3.1); the
  per-type cap holds past ten matches; `q=&` returns `[]` with a `200`.
- **`reports.service` integration**: a client overdue but paid up is absent
  from At risk, and so is one in arrears with every obligation done;
  `overdueObligations` counts instances, not join rows (the assertion that
  catches the fan-out §3.7 avoids); every numeric field is `typeof ===
  'number'`, which catches a missing `::int` — ADR 0007's own note is that it
  fails at serialization, not at migration.
- **`toCsv` unit**: a field containing the delimiter is quoted; an internal
  quote is doubled; output starts with the BOM; the delimiter is `;` under
  `pt-PT` and `,` under `en-GB`.
- **Component**: `SearchResultsPage` renders a group per type and an
  `EmptyState` for none; the `/` shortcut focuses the box and does **not**
  fire while a text field has focus.
- **E2E**: search a client by a three-letter prefix from the home page and
  land on its detail page; open `/reporting` with a client both overdue and
  in arrears and confirm it is listed.

## 7. Risks

- **The Portuguese stemmer is the wrong tool for part of this data.** A tax
  number and a platform name are identifiers, not prose; stemming them is a
  no-op and the prefix operator is what finds them. Harmless, but the ranking
  between a name match and a number match is stable rather than meaningful.
- **`portuguese_unaccent` is a database object a restore must recreate.**
  `pg_dump` carries text-search configurations, so the documented restore
  path is unaffected — but restoring into a database without `unaccent`
  installed fails at the configuration, not at the first query. One line in
  `docs/operations.md`'s restore section, beside the `btree_gist` note.
- No new risk beyond the master spec's §15 otherwise.

## 8. Open questions

1. Should search cover archived clients behind a toggle, the way the clients
   list does with `includeArchived`? Excluded outright here; raise it the
   first time someone cannot find a client they archived.
2. Does the period summary want a per-client breakdown, or is the practice
   total enough? Total only — the per-client figures are already on each
   client's ledger, and a breakdown is a different report, which by §3.7 is a
   change to this document.
