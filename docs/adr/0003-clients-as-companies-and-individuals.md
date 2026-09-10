# 0003 — Clients as companies and individuals, not separate entities

## Context

Goal 5 requires individuals to be first-class clients, linked by employment
to the companies they work for, whether or not they carry their own
business activity. The case that forced the model: one person can
simultaneously be an employee of a company client (personal income tax
filed as `PIT_EMPLOYMENT_ONLY`) *and* have open business activity of their
own (VAT obligations, `PIT_CATEGORY_B`) — the same natural person, two
overlapping fiscal identities, both needing the same shape of record
(a tax ID, a fiscal profile, and — from Phase 1 — vault credentials).

## Decision

One `Client` table with a `ClientKind` discriminator (`COMPANY` |
`INDIVIDUAL`), not separate `Company` and `Person` entities. Both kinds
need identical capabilities — a fiscal profile, vault credentials, a place
to attach employment — so splitting them would duplicate identity (the tax
ID would need to live in two places, free to diverge) for no behavioural
gain. The discriminated fields (`legalForm` for companies;
`socialSecurityNo`, `dateOfBirth` for individuals) are enforced by a
`CHECK` constraint added directly in the migration SQL
(`client_kind_fields`, in `apps/api/prisma/migrations/20260908141839_init/migration.sql`) —
Prisma's schema language has no `CHECK` syntax of its own, so this
constraint exists only in the raw SQL, not as an annotation in
`schema.prisma`.

**`LegalForm` has no `SOLE_TRADER` member**, verified against
`packages/domain/src/enums.ts`'s `LEGAL_FORM_VALUES` (`LDA`,
`UNIPESSOAL_LDA`, `SA`, `ASSOCIATION`, `OTHER`) and the Prisma enum of the
same name. A Portuguese *empresário em nome individual* is a natural
person carrying on business activity, not a distinct corporate legal form;
that client is simply `kind = INDIVIDUAL` with `hasOpenActivity = true` on
their `FiscalProfile`. Folding a sole trader into the same enum as `LDA`
and `SA` would have meant every rule that reads `legalForm` needing a
special case for a value that behaves nothing like the others.

**Employment, not shareholding.** `Employment` links exactly one
`COMPANY` (`employerKind`) to exactly one `INDIVIDUAL` (`employeeKind`),
both enforced by `CHECK` constraints in the same migration plus composite
foreign keys against `Client(id, kind)` — the database, not application
code, makes it structurally impossible to record a company as somebody's
employee. Shareholder and director relationships are explicitly out of
scope (design spec, section 3's non-goals table): only the relationship
the practice actually has a stated need for is modelled.

## Consequences

- Every rule that needs "is this a company or a person" reads one column
  (`Client.kind`) instead of checking which table a row came from.
- The composite unique constraint `@@unique([id, kind])` exists purely so
  that `Employment`'s foreign keys can pin `employerKind`/`employeeKind` at
  the database level — a derived-but-necessary piece of schema, not
  redundant data modelling.
- `FiscalProfile.hasEmployees` cannot be derived from `Employment` rows and
  must stay a manually maintained flag: only clients whose personal
  filings the practice actually handles get an `Employment` record, so the
  employment table is deliberately incomplete as a headcount.

## The recorded path to generalising, if it's ever needed

If shareholders or directors are ever added, the documented path (design
spec, section 6.3) is to generalise `Employment` into a `ClientRelationship`
table carrying a `kind` discriminator (`EMPLOYMENT`, `SHAREHOLDING`,
`DIRECTORSHIP`, …) instead of one dedicated table per relationship type.
Concretely that is a table rename, one added `kind` column, and updating
the `CHECK` constraints that currently hard-code "employer is COMPANY,
employee is INDIVIDUAL" into per-`kind` rules instead. Recording this now
means that migration, if it ever happens, is a considered decision made in
advance rather than a surprise discovered while trying to bolt shareholders
onto a table named `Employment`.

## Revisit when

- A second relationship type between clients (shareholding, directorship)
  is actually requested — at that point the `ClientRelationship`
  generalisation above should be executed rather than adding a second
  parallel table.
- A client's fiscal identity ever needs to change `kind` after creation
  (e.g. a sole trader incorporating) — today this is unmodelled;
  `ClientKind` is treated as fixed for the life of a `Client` row.
