# Phase 2 — Obligations Design

- **Date:** 2026-09-12
- **Status:** Draft
- **Author:** Design session with the product owner

## 1. Context

The master spec (`docs/superpowers/specs/2026-09-04-ledger-hq-design.md`,
sections 5.2, 6.5, 7, 14) already fixes this phase's data model, the
resolver's pure-function signatures, the generator's four invariants, and a
14-row initial fiscal catalog. This document is not a second design from
scratch — it is the decisions the master spec leaves open, made concrete, the
same relationship Phase 1's implementation plan had to the master spec's
vault sections. Where this document is silent, the master spec governs.

**Standalone value (unchanged from the master spec):** deadlines no longer
depend on memory.

## 2. Scope

In scope for this phase:

- The fiscal catalog (14 rules), the resolver, and the generator, exactly as
  specified in master spec sections 6.5 and 7.
- Manual adjustment: editing a due date, marking an instance `DONE` or
  `WAIVED`, creating an ad-hoc obligation outside the catalog (master spec
  7.4) — included in this phase, not deferred, because a dashboard the
  accountant cannot correct is read-only decoration, not the tool the spec
  promises.
- A global deadline dashboard as the app's home page (`/`), and a per-client
  obligations section on `ClientDetailPage`, mirroring the vault's own
  `CredentialsSection` pattern from Phase 1.
- `docs/fiscal-catalog.md`, generated in both locales from the catalog
  itself (master spec 10.5).

Out of scope, staying with later phases per the master spec's own phasing
(section 14): billing/retainers (Phase 3); file attachments on completed
obligations (explicitly deferred to Phase 4, master spec 16.2); cross-module
reporting (Phase 4).

## 3. Decisions this design makes that the master spec leaves open

### 3.1 Catalog accuracy — reviewed after encoding, not before

The master spec is explicit that the product owner, not the implementer, is
the authority on the 14-rule table (section 7.5) — deadlines change by
legislation and the general-knowledge starting point has an expiry date.
Rather than transcribing and re-confirming each rule line-by-line before any
code exists, the plan encodes the master spec's own table first — each rule
is five lines of data plus a validity range plus a test, exactly as designed
to be cheap to correct — and the owner reviews the complete, running catalog
(and the generated `docs/fiscal-catalog.md`) before this phase is considered
merged. A review checklist item in the implementation plan makes this an
explicit, trackable step, not an assumption.

### 3.2 API shape: one flexible list endpoint, not a bespoke dashboard endpoint

```
GET  /obligations?clientId=<id>&status=<status>[,<status>]
```

Returns a flat, unsorted list of `ObligationInstance` rows (joined with the
definition's denormalised `name`/`authority`/`legalRef` for display). Both the
global dashboard and the per-client section call this same endpoint — the
dashboard omits `clientId`, the per-client section supplies it — and both
group/sort the result client-side via one pure, unit-tested function
(`groupByUrgency`), rather than the server pre-shaping a dashboard-specific
payload. This is the same reasoning that already keeps the resolver's date
logic pure and parameter-driven: one grouping function, testable without a
server, reusable by both screens, and never a second implementation to keep
in sync with the first.

`status` defaults to `PENDING,IN_PROGRESS` when omitted (what a dashboard
wants); an explicit `status=DONE` or `status=WAIVED` is how a "completed
history" view — not built this phase, but not precluded — would ask for the
rest.

```
PATCH /obligations/:id
```

Body: any of `{ dueDate, status, reference, amountCents, notes }`. Setting
`dueDate` sets `dueDateOverridden = true` (master spec 7.4: the generator
must then respect it). Setting `status: 'WAIVED'` requires `notes` non-empty
(the "justification" the master spec names) — enforced by the Zod schema's
`.refine`, not a database constraint, since it is a data-quality rule about a
nullable text field, not a structural invariant.

```
POST /obligations
```

Creates an ad-hoc obligation. Because `ObligationInstance.definitionCode` is
a foreign key, an ad-hoc instance needs its own `ObligationDefinition` row
first — the master spec's own worked example ("Backup restore drill",
section 11.3) is exactly this: a named, reusable `CUSTOM` definition, not a
one-off. The request body therefore carries both the definition fields
(`code`, `name`, `periodicity`) and the instance fields (`clientId`,
`periodStart`/`periodEnd`/`periodLabel`, `dueDate`); the service upserts the
`CUSTOM` definition (idempotent on `code`, so reusing the same ad-hoc type
for a later period does not duplicate the definition row) and creates the
instance in one transaction.

```
POST /obligations/generate?dryRun=<boolean>
```

Body: `{ asOf?: string }` (defaults to today). With `dryRun=true`, runs the
generator's full resolution logic and returns what *would* change —
`{ toCreate: [...], toRetract: [...] }` — without writing anything. Without
it, applies exactly that result. The UI always calls `dryRun=true` first,
shows the diff, and only calls the real run on explicit confirmation — the
"preview of the changes before confirmation" the master spec names for the
after-fiscal-profile-save trigger (section 7.3), reused here as the one
generation entry point every trigger (cron, manual profile-save, an explicit
"regenerate" button) goes through.

### 3.3 Scheduling: `@nestjs/schedule`, the first in-process cron in this codebase

The existing daily backup (`docker/backup.sh`) runs from the *host's*
crontab, entirely outside the application — appropriate for a script that
needs `pg_dump` and `age` on the host's `$PATH`, wrong for logic that already
lives in, and is tested as part of, the API. The master spec's own words for
this feature — "runs on a daily cron **inside the backend**" (section 7.3)
— name the in-process form directly. `@nestjs/schedule`'s `@Cron()` decorator
is the standard NestJS mechanism for that: no new infrastructure, runs in the
same process already holding the Prisma connection, and is unit-testable by
calling the decorated method directly (Nest's own docs pattern), same as
every other service method in this codebase.

### 3.4 Dashboard placement and shape

`/` currently renders nothing (`apps/web/src/router.tsx`'s `indexRoute`,
`component: () => null` — a placeholder since Phase 0). It becomes the
obligations dashboard: every `PENDING`/`IN_PROGRESS` instance across all
clients, grouped into four sections by `groupByUrgency` — **Overdue**
(`dueDate < today`), **This week**, **This month**, **Later** — each row
showing client name, obligation name (from the catalog's `i18n`), due date,
and an inline "mark done" action. This directly serves the master spec's
goal 2 ("statutory deadlines derived automatically") the way goal 5 ("who
owes me money") is Phase 3's dashboard equivalent for billing.

`ClientDetailPage` gains an `ObligationsSection`, placed after the existing
`CredentialsSection` (Phase 1) and before `EmploymentSection`, or immediately
after `EmploymentSection` — whichever the implementer finds the current file
already orders logically; this is page layout, not a decision worth
pre-committing in a design doc. It lists that one client's instances (same
`groupByUrgency` grouping) and hosts the manual-adjustment controls.

Unlike `CredentialsSection`, this section needs no `VaultUnlockGate`: like
the platform catalog (Phase 1's own "Decisions" section 6.4), obligation
data is plaintext metadata by design — deadlines and statuses are not
secrets — so it needs a session like any other page, never the unwrapped
vault key.

### 3.5 i18n split: catalog inline, UI chrome in `obligations.json`

Per master spec 10.5, the 14 catalog rules carry their own `i18n: { pt, en }`
blocks inline in `packages/domain/src/obligations/catalog/*.ts` — never
routed through the locale JSON files, so a legal-reference correction and its
name/description correction are reviewed as one unit. Everything else user-
facing (dashboard section headings, the "mark done" button, the manual-
adjustment form's labels, status names for `ObligationStatus` /
`Periodicity` / `Authority`) goes through a new `apps/web/src/i18n/locales/
{pt,en}/obligations.json`, registered in both locale `index.ts` files
alongside `vault`/`domain`/etc. — the same split Phase 1 already established
between vault UI copy (`vault.json`) and vault-adjacent domain enums
(`domain.json`'s `authKind` block); `ObligationStatus`/`Periodicity`/
`Authority` display names join `domain.json` for the same reason `authKind`
did.

`docs/fiscal-catalog.md` is generated by a small script
(`packages/domain/scripts/generate-fiscal-catalog.mjs`, in the same spirit as
`apps/web/scripts/check-locales.mjs`) that imports the catalog and writes
both languages into one Markdown file, checked into the repo. Regenerating it
is a step in the implementation plan's catalog task, not a CI-enforced gate
this phase — `i18n:check`-style enforcement that the file is up to date is a
reasonable Phase 4 hardening, not a blocker here.

## 4. Data model

No changes from the master spec's section 6.5 (`ObligationDefinition`,
`ObligationInstance`) — reproduced here only for reference, the master spec
is authoritative:

```prisma
model ObligationDefinition {
  code        String @id
  name        String
  authority   Authority
  periodicity Periodicity
  source      DefinitionSource
  legalRef    String?
  active      Boolean
}

model ObligationInstance {
  id                String   @id
  clientId          String
  definitionCode    String
  periodStart       DateTime @db.Date
  periodEnd         DateTime @db.Date
  periodLabel       String
  dueDate           DateTime @db.Date
  dueDateOverridden Boolean  @default(false)
  status            ObligationStatus
  completedAt       DateTime?
  reference         String?
  amountCents       Int?
  notes             String?
  @@unique([clientId, definitionCode, periodStart])
}
```

`Authority`, `Periodicity`, `ObligationStatus`, `DefinitionSource` are new
`packages/domain` enums (`enums.ts`, following `AUTH_KIND_VALUES`'s existing
pattern) mirrored as Prisma enums, matching how `AuthKind` already crosses
that boundary in Phase 1.

## 5. Module layout

```
packages/domain/src/
├── enums.ts                              + Authority, Periodicity, ObligationStatus, DefinitionSource
├── errors.ts                              + obligation-specific codes (waived-without-reason, etc.)
├── obligations/
│   ├── catalog/
│   │   ├── tax.ts                         VAT, EFatura, Modelo 22, Modelo 10, Modelo 30, IES, CIT payments
│   │   ├── social-security.ts             SS remuneration + contribution
│   │   └── individual.ts                  Modelo 3 (PIT)
│   ├── resolver.ts                        appliesTo, generatePeriods, resolveDueDate
│   ├── resolver.test.ts                    table-driven, one row per case
│   ├── holidays.ts                         fixed PT holidays + Easter-derived (computus) + business-day shift
│   ├── holidays.test.ts
│   └── group-by-urgency.ts                pure grouping fn shared by both web screens
└── schemas/
    └── obligation.ts                       Zod: createAdHocObligationSchema, patchObligationSchema, generateQuerySchema
packages/domain/scripts/
└── generate-fiscal-catalog.mjs
apps/api/src/obligations/
├── obligations.module.ts
├── obligations.service.ts                  generator (dry-run + apply), CRUD, cron entry point
├── obligations.controller.ts
└── obligations.cron.ts                     @Cron() wrapper calling the service — kept separate so the service itself has zero NestJS scheduling coupling and stays unit-testable like any other service
apps/web/src/obligations/
├── api.ts
├── ObligationsDashboard.tsx                 the new home page
├── ObligationsSection.tsx                   per-client, ClientDetailPage
├── ObligationRow.tsx                        shared by both screens
├── AdjustObligationForm.tsx                 due-date edit / done / waived / notes
└── AddAdHocObligationForm.tsx
apps/web/src/i18n/locales/{pt,en}/
└── obligations.json                         new namespace
docs/
└── fiscal-catalog.md                        generated, both languages
```

No catalog file for the `REGISTRY`/`OTHER` `Authority` values: none of the
initial 14 rules uses them. Add a sibling to `tax.ts` when a rule needs one
— an empty placeholder file buys nothing today.

## 6. Testing

- **Resolver:** table-driven `(rule, period) → expected deadline`, including
  a weekend shift, a national-holiday shift, and a leap year, per master spec
  7.6.
- **Catalog:** one test per rule (14), asserting the resolved deadline for at
  least one real period against a real calendar — the "verifiable at a
  glance" property the master spec asks for.
- **Generator:** idempotency (run twice, one result), retraction (profile
  loses a condition → future `PENDING` instances for that rule disappear,
  past ones don't), never-rewrites-the-past (a client onboarded today with
  three years of theoretical arrears gets only the last 3 months, per master
  spec 7.3's third invariant), and the dry-run/apply pair returning the same
  diff dry-run computed.
- **API:** integration tests for the manual-adjustment endpoints (waived
  requires a reason; ad-hoc creation upserts the `CUSTOM` definition
  idempotently; `dueDateOverridden` sticks across a later generator run).
- **Web:** `groupByUrgency` unit tests (a pure function, cheap to cover
  exhaustively); component tests for `ObligationsDashboard`/
  `ObligationsSection`/the two forms, following the existing
  `CredentialsSection.test.tsx`/`PlatformsPage.test.tsx` patterns.
- **Cron:** a test that the `@Cron()`-decorated method delegates to the
  service's own (already-tested) generation logic — not a test of NestJS's
  scheduler itself.

## 7. Risks carried over from the master spec (section 15)

- Fiscal catalog inaccurate or outdated — mitigated by 3.1 above and the
  owner's explicit review gate before merge.
- No new risks introduced beyond what the master spec already names for this
  phase.

## 8. Open questions

None outstanding — the two items the master spec itself leaves open
(retainer amount/VAT split; file attachments on completed obligations) both
belong to later phases (3 and 4 respectively) and are out of scope here.
