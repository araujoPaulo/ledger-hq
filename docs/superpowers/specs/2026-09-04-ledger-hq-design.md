# Ledger HQ — Design Specification

- **Date:** 2026-09-04
- **Status:** Approved
- **Author:** Design session with the product owner

## 1. Context

The product owner runs a small accountancy practice in Portugal, serving clients
across several industries under both organized and simplified accounting
regimes. Beyond bookkeeping, the practice absorbs a large amount of
administrative work for its clients, most of which are small businesses.

Three recurring problems drive this project:

1. **Credentials.** Every client has logins for several government platforms
   (tax authority, social security, invoice reporting, registries). They are
   scattered across notes, memory and ad-hoc files.
2. **Fiscal obligations.** Each client generates a stream of filings and
   payments with statutory deadlines that depend on their fiscal profile.
   Missing one has financial consequences.
3. **Retainers.** Clients pay a recurring fee plus occasional extra work.
   Knowing who has paid the current month, and who is several months behind,
   currently requires manual reconstruction.

The system must be usable from a desktop computer and a phone, and must keep
working when the backend is unreachable.

## 2. Goals

- A single-user system that consolidates client records, credentials, fiscal
  obligations and retainer billing.
- Credentials protected such that neither the server nor its backups can expose
  them.
- Credentials readable with no network connection at all.
- Statutory deadlines derived automatically from each client's fiscal profile.
- Individuals held as first-class clients, linked by employment to the companies
  they work for, whether or not they have business activity of their own.
- A direct answer to "who owes me money, and for how long".
- Installable on desktop and phone without app stores.
- Bilingual interface: Portuguese and English.
- Room to grow: new modules must not require restructuring the system.

## 3. Non-goals

Explicitly out of scope. Each was considered and rejected.

| Excluded | Reason |
|---|---|
| Multi-user accounts and permissions | Single user. Removes auth complexity and an entire class of bugs. |
| Client-facing portal | Large external attack surface for no stated need. |
| Invoice or receipt issuance | Portuguese law requires AT-certified software and SAF-T. Disproportionate. |
| Email or push notifications | Owner prefers a dashboard. Removes SMTP, VAPID and delivery failure modes. |
| Data import from spreadsheets | No consolidated existing dataset to import. |
| Offline writes outside read caching | Only credential reads must work offline. See section 9. |
| Native mobile applications | A PWA meets the requirement without a second codebase or store fees. |
| CRDT-based synchronisation | A single user generates almost no genuine conflicts. |
| Payroll processing | Salaries, contracts and categories are a separate domain. Employment records hold dates and job title only. |
| A complete company headcount | Only people the practice actually works for are recorded. See section 6.3. |
| Shareholder and director relationships | Only employment is modelled. Generalisation path documented in section 6.3. |

## 4. Decision summary

| Area | Decision |
|---|---|
| Users | Single user |
| Client kinds | Companies and individuals, linked by employment |
| Hosting | Self-hosted on an office machine |
| Remote access | Tailscale private network |
| Credential security | Zero-knowledge, end-to-end encrypted |
| Obligations | Rule engine over a Portuguese fiscal catalog |
| Billing | Recurring retainers plus ad-hoc extras, with an account ledger |
| Offline | Credential reads offline; read-only cache elsewhere |
| Clients | Single installable PWA |
| Stack | TypeScript monorepo |
| Alerts | Dashboard only |
| Locales | `pt-PT` (default) and `en-GB` |

## 5. Architecture

### 5.1 Repository layout

```
ledger-hq/
├── apps/
│   ├── api/          NestJS + Prisma + PostgreSQL
│   └── web/          React + Vite + TanStack Query/Router (PWA)
├── packages/
│   ├── domain/       types, Zod schemas, fiscal catalog, deadline rules
│   ├── crypto/       vault primitives (Argon2id, AES-GCM, key envelope)
│   └── config/       shared tsconfig, eslint, prettier
├── docker/           Dockerfiles and compose definition
└── docs/
```

`domain` and `crypto` are packages rather than API-internal modules because both
run on the server and in the browser. The fiscal catalog validates server-side
and previews client-side; the crypto encrypts in the browser while the server
needs only the types. Each rule is written once.

### 5.2 Backend modules

| Module | Responsibility | Depends on |
|---|---|---|
| `auth` | Login, session, vault unlock handshake | — |
| `clients` | Client records and fiscal profiles | — |
| `vault` | Encrypted credential storage, platform catalog | `clients` |
| `obligations` | Catalog, instance generation, status tracking | `clients` |
| `billing` | Retainer plans, charges, payments, allocations | `clients` |
| `reporting` | Cross-module read models | all |

Dependencies flow in one direction. `clients` is the core; `vault`,
`obligations` and `billing` do not know about each other. Any view that combines
obligations and debt belongs in `reporting`, never in a lateral dependency.

Each module exposes a typed service. No module reaches into another module's
Prisma models. This keeps every module small enough to read in full and to test
in isolation.

The `clients` module owns both client kinds and the employment relationship
between them. Its screens are: a client list filtered and visually distinguished
by kind; a company record with an *Employees* section listing linked people with
their spells and job titles; and a person record with an *Employments* section
listing employers. Creating an employee from a company record pre-fills the
link.

### 5.3 API contract

REST under `/api/v1`. Request and response validation uses Zod schemas from
`packages/domain`, shared with the frontend. NestJS decorators generate the
OpenAPI document.

### 5.4 Technology rationale

**pnpm workspaces** — content-addressed store avoids duplicate copies of shared
packages and enforces strict dependency declaration. **Turborepo** caches builds
and tests so unrelated packages do not rebuild.

**NestJS** — chosen for enforced structure rather than performance. The module
boundaries described above are compile-time errors under Nest, not conventions
that erode. Dependency injection makes the deadline engine testable with an
injected clock instead of patching `Date`. Zod schemas attach as a global
validation pipe. Decorators generate OpenAPI. The cost is boilerplate and a
learning curve, justified by three subsystems with real logic: the rule engine,
the billing ledger and the vault.

Rejected: Fastify alone (architecture left to convention), tRPC (couples the
client to the server and precludes a future native app), Hono (edge-oriented,
irrelevant when self-hosted).

**Prisma** — a single declarative schema file documents the whole data model,
migrations are versioned and reviewable SQL, and types derive from the schema so
a column change breaks compilation exactly where work is needed. Raw typed SQL
covers aggregate reporting. Drizzle was the serious alternative and loses on
migration tooling and schema readability.

**PostgreSQL** — the system is fundamentally about dates and periods. Postgres
provides real `date` and `interval` types and calendar arithmetic; `EXCLUDE`
constraints prevent overlapping retainer plans and duplicate obligation
instances; `bytea` stores ciphertext natively; `pg_dump` makes backups trivial.
SQLite was rejected because its weak date typing would push all calendar
arithmetic into application code.

**React + Vite** — the only ecosystem with mature answers for PWA, IndexedDB,
WebCrypto and accessible components together. Vite provides a fast dev server
and `vite-plugin-pwa` for service worker generation. Next.js was rejected: SSR
offers nothing to a private, authenticated, offline-capable application.

**TanStack Query** degrades gracefully when the backend is unavailable.
**TanStack Router** provides typed search parameters, so filtered lists live in
the URL and remain shareable and reloadable.

**WebCrypto** provides audited AES-256-GCM with non-extractable keys.
**Argon2id via WASM** handles password derivation, because WebCrypto offers only
PBKDF2, which is weak against GPU attack.

**Zod** gives one definition serving as TypeScript type, server validator and
form validator, preventing divergence between `api` and `web`.

**Docker Compose** with `restart: unless-stopped` ensures the office machine
recovers unattended after a power cut, and pins the Postgres version.

## 6. Data model

Five aggregates: `Client` at the centre, with `Vault`, `Obligations` and
`Billing` around it, and `Audit` cutting across.

### 6.1 Cross-cutting conventions

- **Identifiers:** UUIDv7. Time-sortable for index locality and non-enumerable.
- **Money:** integer cents (`amountCents Int`). Never floating point. Currency
  fixed to EUR.
- **Dates:** `date` for deadlines and periods, which have no time-of-day;
  `timestamptz` for events. Application timezone is `Europe/Lisbon`.
- **Deletion:** only `Client` supports soft deletion via `archivedAt`.
  Everything else is protected by foreign keys. Fiscal history is not deleted.

### 6.2 Core

A client is either a company or a natural person. Both kinds need exactly the
same capabilities — vault credentials and their own fiscal obligations — so a
separate `Person` entity was rejected: it would duplicate identity and leave the
same tax number in two places, free to diverge.

```prisma
enum ClientKind { COMPANY, INDIVIDUAL }

model Client {
  id               String     @id
  kind             ClientKind
  name             String
  taxId            String     @unique     // NIF; person and company ranges never collide in PT
  accounting       Accounting             // ORGANIZED | SIMPLIFIED
  email            String?
  phone            String?
  notes            String?
  archivedAt       DateTime?
  // COMPANY only
  legalForm        LegalForm?             // LDA | UNIPESSOAL_LDA | SA | ASSOCIATION | OTHER
  // INDIVIDUAL only
  socialSecurityNo String?                // NISS
  dateOfBirth      DateTime? @db.Date
  fiscalProfile    FiscalProfile?
  @@unique([id, kind])                    // target for composite foreign keys
}
```

`LegalForm` deliberately has no `SOLE_TRADER` member. A Portuguese *empresário em
nome individual* is a natural person carrying on business activity, not a
corporate legal form. Such a client is `kind = INDIVIDUAL` with
`hasOpenActivity = true`. This removes an ambiguity in which a sole trader and a
limited company shared one enum while behaving differently in every rule that
consults it.

A `CHECK` constraint enforces the discriminated fields: `legalForm` is required
when `kind = COMPANY` and null otherwise; `socialSecurityNo` and `dateOfBirth`
are permitted only when `kind = INDIVIDUAL`.

```prisma
model FiscalProfile {
  clientId        String  @id
  hasOpenActivity Boolean      // always true for COMPANY
  vatRegime       VatRegime    // MONTHLY | QUARTERLY | EXEMPT | NOT_APPLICABLE
  incomeTax       IncomeTax    // CIT | PIT_CATEGORY_B | PIT_EMPLOYMENT_ONLY
  hasEmployees    Boolean      // COMPANY only
  hasWithholding  Boolean
  isVatCashBasis  Boolean
  startedAt       DateTime @db.Date
}
```

Three representative profiles:

| Situation | `kind` | `hasOpenActivity` | `vatRegime` | `incomeTax` |
|---|---|---|---|---|
| Company | COMPANY | true | MONTHLY / QUARTERLY | CIT |
| Employee whose personal income tax return the practice files | INDIVIDUAL | false | NOT_APPLICABLE | PIT_EMPLOYMENT_ONLY |
| Employee who also invoices independently | INDIVIDUAL | true | QUARTERLY / EXEMPT | PIT_CATEGORY_B |

The third row is the case that motivated this model: one person is an employee
of a company client *and* has open activity, carrying VAT obligations of their
own on top of the personal income tax return.

`FiscalProfile` is the input to the obligation engine. It is mutable: when a
client moves from quarterly to monthly VAT, the profile is edited. Previously
generated instances remain untouched because they are historical records. The
change is written to the audit log.

### 6.3 Employment

Only people the practice actually works for are recorded — not every employee on
a company's payroll. A company with fifteen employees whose personal filings the
practice does not handle has no employee records at all. As a consequence,
`FiscalProfile.hasEmployees` remains a manually maintained flag on the company
profile; it cannot be derived from employment records, because those are
deliberately incomplete.

```prisma
model Employment {
  id           String     @id
  employerId   String
  employerKind ClientKind             // pinned to COMPANY by CHECK
  employeeId   String
  employeeKind ClientKind             // pinned to INDIVIDUAL by CHECK
  startedOn    DateTime  @db.Date
  endedOn      DateTime? @db.Date
  jobTitle     String?
  notes        String?

  employer Client @relation("employer", fields: [employerId, employerKind], references: [id, kind])
  employee Client @relation("employee", fields: [employeeId, employeeKind], references: [id, kind])
}
```

The `employerKind` and `employeeKind` columns are not decorative redundancy.
They are what lets PostgreSQL guarantee that a company can never be recorded as
somebody's employee: a composite foreign key against `Client(id, kind)` plus a
`CHECK` pinning each column to its one legal value. The invariant lives in the
database rather than in hope.

Three further constraints:

- `CHECK (employer_id <> employee_id)` — nobody employs themselves.
- `EXCLUDE USING gist` over `(employer_id, employee_id, daterange(started_on, ended_on))`
  — no overlapping spells for the same pair. Re-hiring after termination is a new
  row, preserving both spells.
- No constraint across different pairs: one person may hold concurrent
  employments with two companies, which happens in practice.

Archiving a company does not archive its employees; they are independent
clients. Ending an employment means setting `endedOn`, never deleting the row.

**Deliberate limitation.** The table models employment only, as scoped. Adding
shareholders and directors later means generalising it to `ClientRelationship`
with a `kind` discriminator — a table rename plus one column. Recorded here so
that the future migration is a considered decision rather than a surprise.

### 6.4 Vault

```prisma
model Platform {
  id       String @id
  name     String
  url      String?
  authKind AuthKind                 // PASSWORD | PASSWORD_OTP | CERTIFICATE
}

model Credential {
  id         String   @id
  clientId   String
  platformId String
  label      String                 // distinguishes multiple logins on one platform
  updatedAt  DateTime
  versions   CredentialVersion[]
  @@unique([clientId, platformId, label])
}

model CredentialVersion {
  id           String   @id
  credentialId String
  ciphertext   Bytes                // AES-256-GCM
  iv           Bytes
  createdAt    DateTime
}
```

Only `clientId`, `platformId` and `label` are stored in clear: the minimum
needed to list, filter and index without unlocking the vault. Username,
password, PIN, TOTP secret, extra fields and notes are all inside `ciphertext`.

`CredentialVersion` provides rotation history at no extra cost. The current
version is the most recent; earlier ones remain available when a portal rejects
a newly changed password.

### 6.5 Obligations

```prisma
model ObligationDefinition {
  code        String @id            // "VAT_QUARTERLY_RETURN"
  name        String                // pt-PT designation, denormalised for queries
  authority   Authority             // TAX | SOCIAL_SECURITY | REGISTRY | OTHER
  periodicity Periodicity           // MONTHLY | QUARTERLY | ANNUAL | ONE_OFF
  source      DefinitionSource      // CATALOG | CUSTOM
  legalRef    String?
  active      Boolean
}

model ObligationInstance {
  id             String   @id
  clientId       String
  definitionCode String
  periodStart    DateTime @db.Date
  periodEnd      DateTime @db.Date
  periodLabel    String              // "2026-Q1"
  dueDate        DateTime @db.Date
  dueDateOverridden Boolean @default(false)
  status         ObligationStatus    // PENDING | IN_PROGRESS | DONE | WAIVED
  completedAt    DateTime?
  reference      String?             // submission receipt number
  amountCents    Int?                // tax payable, where applicable
  notes          String?
  @@unique([clientId, definitionCode, periodStart])
}
```

The rules themselves — which profiles an obligation applies to and how its
deadline is computed — are not stored in the database. They live in
`packages/domain` as typed data, reviewed in code review and covered by tests.
The `ObligationDefinition` table is a seeded mirror that exists so foreign keys
work. Its `name` column holds the `pt-PT` designation copied from the catalog
entry's `i18n` block (section 10.5), denormalised so server-side queries and
exports can label a definition without loading the catalog. The catalog in
`packages/domain` is the single source of truth; the table is never edited
directly except for `CUSTOM` definitions created through the UI.

The unique constraint guarantees that no client ever has two VAT returns for the
same quarter, however often the generator runs.

"Overdue" is not stored state. It is `status != DONE && dueDate < today`.

### 6.6 Billing

```prisma
model RetainerPlan {
  id            String   @id
  clientId      String
  amountCents   Int
  periodicity   Periodicity
  dueDayOfMonth Int                 // 1-28
  validFrom     DateTime @db.Date
  validTo       DateTime? @db.Date  // null = currently in force
}

model Charge {
  id          String   @id
  clientId    String
  kind        ChargeKind            // RETAINER | EXTRA
  description String
  periodLabel String?               // "2026-03" for retainers
  amountCents Int
  issuedOn    DateTime @db.Date
  dueOn       DateTime @db.Date
  planId      String?
  writtenOffAt DateTime?
  writeOffReason String?
  @@unique([clientId, planId, periodLabel])
}

model Payment {
  id          String   @id
  clientId    String
  amountCents Int
  receivedOn  DateTime @db.Date
  method      PaymentMethod         // TRANSFER | CASH | DIRECT_DEBIT | OTHER
  reference   String?
  allocations PaymentAllocation[]
}

model PaymentAllocation {
  paymentId   String
  chargeId    String
  amountCents Int
  @@id([paymentId, chargeId])
}
```

`PaymentAllocation` is the load-bearing part. Without it, a client transferring
360 EUR to clear four months of arrears has no honest representation. With it:
one `Payment` of 360 EUR distributed across four 90 EUR charges. It equally
covers the inverse case of a partial payment.

Everything the owner asked for derives from this:

- **Client balance** = sum of charges minus sum of allocations.
- **Months in arrears** = count of `RETAINER` charges past due and not fully
  allocated.
- **Paid this month?** = a charge for the current period exists and is fully
  allocated.

`RetainerPlan` is time-bounded so a fee increase does not rewrite history. The
old plan is closed with `validTo` and a new one created; 2025 charges keep 2025
prices. A Postgres `EXCLUDE USING gist` constraint prevents overlapping plans
for the same client.

### 6.7 Audit

```prisma
model AuditEvent {
  id         String   @id
  entityType String
  entityId   String
  action     String                 // "credential.revealed", "profile.changed"
  metadata   Json
  occurredAt DateTime
}
```

Records fiscal profile changes, credential rotations and every credential
decryption. The last of these answers, months later, when an access was last
used, and is the only forensic trail available if a device is compromised.

## 7. Obligation engine

Three separated pieces: the **catalog** (data), the **resolver** (pure
functions) and the **generator** (a service with effects).

### 7.1 Catalog

Lives in `packages/domain/src/obligations/catalog/`, one file per authority.
Each entry is declarative:

```ts
export const VAT_QUARTERLY_RETURN: ObligationDefinition = {
  code: 'VAT_QUARTERLY_RETURN',
  authority: 'TAX',
  periodicity: 'QUARTERLY',
  legalRef: 'CIVA art. 41.º',
  appliesWhen: {
    all: [
      { field: 'hasOpenActivity', op: 'eq', value: true },
      { field: 'vatRegime', op: 'eq', value: 'QUARTERLY' },
    ],
  },
  deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 20, monthsAfter: 2 },
  businessDayShift: 'NEXT',
  validFrom: '2023-01-01',
  validTo: null,
  i18n: {
    pt: { name: 'Declaração periódica de IVA', description: 'Regime trimestral' },
    en: { name: 'Declaração periódica de IVA', description: 'Quarterly VAT return' },
  },
}
```

`validFrom` and `validTo` are mandatory. Statutory deadlines change; the VAT
return deadline has moved between the 10th, 15th and 20th within living memory.
Without validity dates, correcting a rule in 2027 would rewrite 2025 deadlines
and the history would start lying. The resolver always selects the rule version
in force at the end of the period being computed.

`appliesWhen` is data rather than a predicate function. This costs a little
expressiveness and buys two things: the UI can explain itself ("applies because:
quarterly VAT and has employees"), and rules are inspectable without reading
code. User-created `CUSTOM` definitions use the same structure.

Conditions address a flattened subject combining the client's `kind` with its
fiscal profile, so a rule can require `kind = COMPANY` or
`hasOpenActivity = false` as naturally as it requires a VAT regime.

### 7.2 Resolver

```ts
appliesTo(definition, { clientKind, profile }, period): boolean
generatePeriods(periodicity, from, to): Period[]
resolveDueDate(definition, period): LocalDate
```

`resolveDueDate` applies the rule and then shifts forward to the next business
day when the result falls on a weekend or public holiday. The holiday calendar
is a function: fixed national holidays plus Easter-derived movable ones (Good
Friday, Corpus Christi) via a computus algorithm. Municipal holidays are
deliberately excluded, as tax deadlines are national.

No I/O, no dependencies, and `Date.now()` is never called. The current date is
always a parameter. This is what makes the engine genuinely testable.

### 7.3 Generator

```ts
generate({ asOf, horizonMonths: 12 })
```

For each active client, it combines the fiscal profile with the catalog,
produces periods up to the horizon and upserts instances. Four invariants:

1. **Idempotent.** Ten runs produce one result, enforced by the unique
   constraint.
2. **Never touches your work.** Instances with a status other than `PENDING` are
   left alone even if the rule changes.
3. **Never rewrites the past.** Only creates instances with
   `periodEnd >= asOf - 3 months`, so a newly onboarded client with arrears is
   captured without flooding the database with a decade of fiction.
4. **Retracts forward only.** If a client stops having employees, future
   `PENDING` payroll instances disappear; past and already-handled ones remain.

It runs on a daily cron inside the backend and on demand, including
automatically after a fiscal profile is saved, with a preview of the changes
before confirmation.

### 7.4 Manual adjustment

An instance can be edited: the deadline changed (flagged `dueDateOverridden`,
which the generator then respects), marked `WAIVED` with a justification, or
created ad hoc outside the catalog. The engine proposes; the accountant decides.

### 7.5 Initial catalog

| Code | Applies to | Deadline |
|---|---|---|
| `VAT_MONTHLY_RETURN` / `VAT_QUARTERLY_RETURN` | with open activity | 20th of the 2nd following month |
| `VAT_PAYMENT` | with open activity | 25th of the 2nd following month |
| `EFATURA_INVOICE_REPORTING` | with open activity | 5th of the following month |
| `DMR_AT` | company | 10th of the following month |
| `SS_REMUNERATION_DECLARATION` | company | 10th of the following month |
| `SS_CONTRIBUTION_PAYMENT` | company | 20th of the following month |
| `WITHHOLDING_TAX_PAYMENT` | company | 20th of the following month |
| `MODEL_22_CIT_RETURN` | company | 31 May |
| `IES_ANNUAL_FILING` | company | 15 July |
| `CIT_PAYMENT_ON_ACCOUNT` | company | July, September, 15 December |
| `MODEL_10_INCOME_WITHHOLDING` | company | 31 January |
| `MODEL_3_PIT_RETURN` | individual | 1 April to 30 June |
| `MODEL_30_NON_RESIDENT_PAYMENTS` | company | end of the 2nd following month |
| `INVENTORY_REPORTING` | company | 31 January |

The *applies to* column summarises `appliesWhen`; the authoritative condition is
the catalog entry itself. Note that an individual with open activity picks up the
VAT rules alongside the personal income tax return, which is exactly the
employee-with-side-activity case from section 6.2.

**The product owner is the authority on this table, not the implementer.** The
catalog is seeded from general knowledge, which has an expiry date, while tax
deadlines change frequently. Line-by-line review by the owner is a required step
before the obligations phase is considered complete. The design makes that cheap:
each rule is five lines of data with validity dates, in one file, with a test
beside it.

### 7.6 Testing

Table-driven tests over the resolver: a list of `(rule, period) -> expected
deadline` cases including weekend and holiday shifts and leap years, one case
per line, verifiable at a glance against a real calendar. The generator has
idempotency and profile-retraction tests.

## 8. Billing

Same shape as the obligation engine: an idempotent **generator**, pure
**allocation functions** and read **views**.

### 8.1 Charge generation

```ts
generateCharges({ asOf })
```

For each in-force `RetainerPlan`, creates one `Charge` per period that has
already started. Unlike obligations there is no future horizon: December's
retainer must not appear as debt in March. A charge is born when its period
begins.

- `dueOn` is `dueDayOfMonth` within the period's month, clamped to the last day
  of short months.
- Idempotency comes from `@@unique(clientId, planId, periodLabel)`.
- Runs on the same daily cron as the obligation generator.
- Archiving a client closes the plan with `validTo`, and no further charges are
  created.
- A retainer plan is optional. An individual whose personal filings are covered
  by their employer's retainer has no plan of their own and never appears in
  receivables. Charging them separately means creating an `EXTRA` charge on their
  own record.

**Assumption:** `amountCents` is the gross amount owed, VAT included. Taxable
base and VAT are not separated, because the system issues no documents. Adding
`vatRatePercent` to the plan and deriving the base is a small change if the
owner later needs the breakdown.

### 8.2 Payment allocation

The core is a pure function:

```ts
proposeAllocation(payment, openCharges): Allocation[]
```

The strategy is FIFO — oldest open charge first, until the received amount is
exhausted. The screen flow:

1. Record 360 EUR, bank transfer, received 2026-09-03.
2. The system proposes 4 x 90 EUR against May, June, July and August.
3. The owner confirms or redistributes.

The proposal is never applied automatically. FIFO is right most of the time, but
when a client deliberately pays the current month and leaves the arrears behind,
only the accountant knows.

**Excess** remains unallocated on the `Payment` and functions as client credit,
consumed automatically in the next proposal. A client paying a quarter in
advance is represented correctly.

**Write-off** uses `Charge.writtenOffAt` with a reason. It leaves receivables
without leaving history.

### 8.3 Derived state

`Charge` has no `status` column. A charge is settled because allocations sum to
its amount, not because a column says so and might drift.

```sql
CREATE VIEW charge_balances AS
SELECT c.id, c.client_id, c.amount_cents,
       COALESCE(SUM(a.amount_cents), 0)                       AS allocated_cents,
       c.amount_cents - COALESCE(SUM(a.amount_cents), 0)      AS outstanding_cents,
       CASE
         WHEN c.written_off_at IS NOT NULL                       THEN 'WRITTEN_OFF'
         WHEN COALESCE(SUM(a.amount_cents), 0) >= c.amount_cents THEN 'SETTLED'
         WHEN COALESCE(SUM(a.amount_cents), 0) > 0               THEN 'PARTIAL'
         ELSE 'OPEN'
       END                                                    AS status
FROM charges c
LEFT JOIN payment_allocations a ON a.charge_id = c.id
GROUP BY c.id;
```

Same principle as overdue obligations: what can be computed is not stored.

### 8.4 Views

- **Per client** — a chronological ledger of charges and payments with a running
  balance. Answers "how much is owed" and "since when".
- **Global** — a receivables table with ageing buckets (0-30, 31-60, 61-90, 90+),
  sorted worst first, including months in arrears and oldest outstanding charge.
- **Current month** — who has paid, who has not, and how much is outstanding.

### 8.5 Testing

Allocation is money arithmetic and is tested with properties as well as
examples: allocations never exceed the payment, never exceed the charge, and the
client balance always equals charges minus allocations. Table cases cover partial
payment, one payment spanning several months, excess becoming credit, and
write-off of a partially paid charge.

## 9. Vault and offline

### 9.1 One password, two derivations

A single master password is derived in two directions that cannot be inverted
into one another:

```
masterKey = Argon2id(masterPassword, salt = userSalt, m = 64 MiB, t = 3, p = 1)
stretched = HKDF-SHA256(masterKey, info = "ledger-hq:vault") -> 32 bytes
authHash  = Argon2id(masterKey, salt = masterPassword, t = 1)
```

- `stretched` never leaves the device. It unlocks the vault.
- `authHash` is what travels to the server at login. The server stores
  `Argon2id(authHash)` — a hash of a hash.

With the entire database and server disk in hand, an attacker must break
Argon2id twice to reach the vault key. At 64 MiB per attempt, GPU attack stops
being economical.

Two separate passwords (one for login, one for the vault) were rejected: in
practice the same password would be used for both, at which point the server
would see the vault password at login and the zero-knowledge property would die
silently.

The 64 MiB parameter is the safe ceiling for Safari on iPhone. More aggressive
parameters crash the tab on mobile, and a vault that will not open on the phone
is useless.

### 9.2 Key envelope

Credentials are not encrypted with the password-derived key. They are encrypted
with a random 256-bit `vaultKey`, generated once, which the server stores
wrapped:

```
vaultKey          = random(32)
protectedVaultKey = AES-KW(vaultKey, stretched)
recoveryVaultKey  = AES-KW(vaultKey, HKDF(recoveryCode))
```

The reason is operational: changing the master password rewraps one 32-byte key.
Without the indirection, a password change would decrypt and re-encrypt every
credential of every client — a long operation that can fail midway and leave the
vault inconsistent.

**Recovery code:** 128 random bits, displayed exactly once during setup in a
human-transcribable format, wrapping a second copy of the `vaultKey`.

> **Warning.** Losing both the master password and the recovery code means
> permanently losing every stored credential. There is no reset and no backdoor;
> that is the definition of zero-knowledge and the property being bought. The
> recovery code must be kept on paper, off-site. The application will require
> explicit confirmation that it has been stored before the first credential can
> be created.

### 9.3 Item encryption

Each credential version is AES-256-GCM with a random 96-bit IV, never reused.
The plaintext is JSON:

```json
{
  "username": "509123456",
  "password": "...",
  "accessPin": "...",
  "totpSecret": "JBSWY3DP...",
  "extraFields": [{ "label": "Senha de acesso SS", "value": "..." }],
  "notes": "Certified accountant access"
}
```

GCM authenticates, so a wrong key produces a verification error rather than
garbage. This is what allows the master password to be validated offline with no
server involvement.

Storing `totpSecret` is a free win: the application generates the six-digit
codes on the credential screen, removing the need for a separate authenticator
app for portals with two-step verification.

### 9.4 Key lifecycle in memory

- The `vaultKey` is imported as a non-extractable WebCrypto `CryptoKey`. Even
  the application's own code cannot read its bytes.
- It exists only in memory. Never in `localStorage`, `sessionStorage` or
  IndexedDB.
- **Auto-lock** on inactivity (5 minutes, configurable) and when the tab is
  hidden for an extended period.
- Locking releases the reference and clears cached plaintext.
- Copying a password to the clipboard clears it after 30 seconds, to the extent
  the browser permits.

### 9.5 Threat model

**Mitigated:** theft of the office machine, theft of backup files, database
copies, disk-level access to the server, a lost phone holding cached data. In
all of these the data is unusable ciphertext.

**Not mitigated:** an attacker who controls the server and waits for a login.
The server delivers the application JavaScript; malicious JavaScript served
afterwards runs with the key unlocked. No web-based zero-knowledge system solves
this — it is a structural limit of the model, shared with every comparable
product.

Mitigations that do apply: a strict CSP with no `unsafe-inline` and no external
origins, no third-party scripts, no remote fonts or CDNs, `npm audit` in CI, and
Subresource Integrity on assets. The strongest defence is section 11: the server
is not exposed to the internet.

**Also not mitigated:** a compromised device with a keylogger. Nothing does.

### 9.6 Offline operation

Offline unlock works because everything required is cached locally.

| IndexedDB store | Contents | Sensitive in clear |
|---|---|---|
| `vaultMeta` | salt, KDF parameters, `protectedVaultKey` | no |
| `credentials` | metadata plus `ciphertext` and `iv` | no |
| `platforms`, `clients` | name, tax ID, URL — for listing and search | metadata only |
| `outbox` | pending audit events | no |

With no network: the master password is entered, derivation happens locally, the
`vaultKey` unwraps from the cached envelope, and credentials decrypt. The server
takes no part. Zero-knowledge design produces offline capability as a
consequence rather than as extra architecture.

Only credential **reads** work offline. Creating or changing credentials
requires a connection, deliberately. An offline write would create version
divergence exactly where divergence is most dangerous: two different plaintexts
for the same password, with no way to know which one the portal accepts.

**Synchronisation** uses a cursor: on startup, if online, request credentials
changed since the last known `updatedAt`.

**Status is always visible.** The application permanently displays whether it is
online and when it last synchronised. A credential rotated two days ago,
displayed as current with no staleness warning, costs fifteen minutes of failed
login attempts. The indicator is not decoration.

Audit events for offline decryption queue in `outbox` and upload when the
network returns.

### 9.7 PWA caching

Service worker via `vite-plugin-pwa` with Workbox:

- **App shell:** precached. The application opens with no network.
- **API reads** (obligations, billing, clients): `NetworkFirst` with cache
  fallback. Offline shows the last known state, marked as such.
- **Writes:** `NetworkOnly`. They fail with a clear message rather than
  pretending to succeed.

### 9.8 Testing

Known-answer vectors for Argon2id and AES-GCM against their specifications.
Property-based round-trip tests: any plaintext encrypted and decrypted returns
unchanged; any flipped ciphertext bit causes decryption to fail. A full recovery
flow test. And a test asserting that no code path writes plaintext to IndexedDB,
implemented as a spy over the write API that fails if a sensitive field passes
unencrypted.

## 10. Internationalization

Locales: `pt-PT` (default) and `en-GB`.

`en-GB` rather than `en-US` is deliberate. `en-US` renders dates as `09/04/2026`,
an ambiguity that is dangerous in a deadline-tracking system. `en-GB` gives
`04/09/2026`, matching Portuguese ordering.

### 10.1 Library

**i18next with react-i18next.** Mature, supports on-demand namespace loading and
plural rules via `Intl.PluralRules`, and — decisively — supports module
augmentation that makes keys compile-time checked:

```ts
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: typeof import('./locales/pt/index')
  }
}
```

A missing key becomes a compilation error rather than raw text on screen in
production.

Lingui was considered for its compile-time extraction and better ergonomics, and
rejected on ecosystem size — not worth the risk in a concern that crosses the
entire application.

### 10.2 Organisation

Namespaces mirror the backend modules so each file stays small:

```
apps/web/src/locales/
├── pt/  common.json  clients.json  vault.json  obligations.json  billing.json  domain.json
└── en/  (same files)
```

Keys are semantic, never English sentences:

```json
{ "form": { "taxId": { "label": "NIF", "invalid": "NIF inválido" } } }
```

Sentence-as-key looks convenient until fixing an English typo breaks every
translation.

### 10.3 The backend emits codes, not prose

Hard rule: **the API never returns human-readable text.**

```json
{ "error": { "code": "vault.credential.duplicate_label", "params": { "label": "Sócio-gerente" } } }
```

The frontend translates. This keeps the server ignorant of the caller's
language, keeps all messages in one place, and makes the same error read
identically whether it came from server-side or client-side validation.

It applies to Zod as well: a custom `errorMap` in `packages/domain` produces
codes instead of sentences, so one schema validates on both sides with the same
translated message.

`AuditEvent.action` values are already codes by design and therefore translate
at presentation time with no change.

### 10.4 Domain enumerations

`ClientKind`, `LegalForm`, `VatRegime`, `IncomeTax`, `PaymentMethod`, obligation
statuses and charge statuses live in the `domain` namespace:

```json
{ "vatRegime": { "MONTHLY": "Mensal", "QUARTERLY": "Trimestral", "EXEMPT": "Isento" } }
```

A test walks every TypeScript enumeration and fails when a translation is
missing in either locale. Adding an enum value without translating it breaks CI.

### 10.5 The fiscal catalog

Literal translation would be wrong here. *Modelo 22*, *IES* and *DMR* are proper
names of Portuguese legal documents. Someone reading "Form 22" recognises
nothing, and the tax authority portal still calls it Modelo 22.

The rule is: **the official name stays, the explanation translates.** Each
catalog entry therefore carries its own text in both locales, inline (see the
`i18n` field in section 7.1) rather than in the locale files. The rule and its
legal designation are one unit of review: when a deadline changes by
legislation, the name and explanation are visible on the same line being
corrected.

`docs/fiscal-catalog.md` is generated in both languages.

### 10.6 Formatting

Never manual; always `Intl`, through a single `format` module.

| | `pt-PT` | `en-GB` |
|---|---|---|
| Currency | `1 234,56 €` | `€1,234.56` |
| Date | `04/09/2026` | `04/09/2026` |
| Long date | `4 de setembro de 2026` | `4 September 2026` |
| Quarter | `1.º trimestre de 2026` | `Q1 2026` |

Stored `periodLabel` values (`2026-Q1`) stay neutral; they are identifiers, not
prose. The timezone remains `Europe/Lisbon` in both locales: changing language
must never change which day a deadline falls on.

### 10.7 Selection and persistence

Default `pt-PT`. On first visit, `navigator.language` selects English if
appropriate. The choice is stored both in server-side user preferences and in
`localStorage`, so the correct language appears when opening offline before any
API response. Switching updates `<html lang>` immediately without a reload.

### 10.8 Offline

**Both locale bundles are precached by the service worker**, not lazily fetched
over the network. They are a few kilobytes. A vault that opens offline but
displays `clients:form.taxId.label` instead of a label is a broken vault.

### 10.9 Quality gates

- ESLint rule `i18next/no-literal-string` on components, catching text written
  directly into JSX.
- An `i18n:check` CI script that fails when the `pt` and `en` key sets diverge or
  when orphan keys exist that no code references.
- Playwright runs the critical flows in both locales, catching text that breaks
  layout.

## 11. Deployment and operations

### 11.1 Topology

```
+-- office machine ---------------------------+
|  Docker Compose                             |
|   +-- caddy      TLS termination and proxy  |
|   +-- web        PWA static assets          |
|   +-- api        NestJS                     |
|   +-- postgres   named volume               |
+----------------+----------------------------+
                 | Tailscale (WireGuard)
        +--------+--------+
     laptop            phone
```

All services use `restart: unless-stopped`. The Postgres image is pinned to an
exact tag, never `latest`, which would eventually start a new major version and
refuse the existing volume.

### 11.2 Remote access

Tailscale is chosen over Cloudflare Tunnel for one decisive reason: **the server
is never exposed to the internet.** No open port, no automated scanning, no
public login page absorbing brute-force attempts. Only the owner's authenticated
devices reach it.

Three operational details:

- **HTTPS is mandatory, not preferred.** WebCrypto and service workers exist only
  in secure contexts. Without TLS there is no vault and no PWA. Tailscale issues
  valid certificates for the MagicDNS name (`ledger.<tailnet>.ts.net`), Caddy
  serves them, and the application installs on the phone like any ordinary site.
- Tailscale clients on iOS and Android connect automatically.
- An escape route remains: exposing to the internet later means switching Caddy
  to public ACME and adding mandatory WebAuthn at login. Not needed now.

**Hardware:** any always-on machine; a mini PC suffices. A small UPS is worth the
cost, as a power cut during a Postgres write is the most mundane route to a
corrupted database.

### 11.3 Backups

A backup that has never been restored is not a backup.

```
daily 03:00  pg_dump --format=custom
             -> encrypt with age (owner's public key)
             -> local copy   (30-day retention)
             -> remote copy via rclone (12-month retention)
```

The encrypted dump can go to cheap cloud storage without concern: credentials
are already encrypted at source by the vault, and `age` encrypts everything else
on top.

The script writes its result to a `system_health` table. The dashboard shows
"last backup: 9 hours ago". Three consecutive failures turn it red — the
replacement for the email alerting that was declined.

**Quarterly restore drill**, documented in the runbook with exact steps: restore
the dump into a throwaway database and verify row counts. It is registered as a
`CUSTOM` obligation named "Backup restore drill", so the system reminds itself to
verify itself.

**Stored separately from backups, on paper:** the master password and the
recovery code. A restored dump without them is a steel vault with no key.

### 11.4 Updates

`git pull && docker compose up -d --build`, with Prisma migrations running at
`api` startup. Manual and deliberate, not automatic — a failed migration must
not be discovered on the 20th of a VAT month. The runbook documents rollback:
stop, restore the overnight dump, return to the previous tag.

### 11.5 Logging

Structured `pino` with mandatory redaction: vault request bodies, `ciphertext`,
`authHash` and authorization headers never enter the log. A test enforces this,
because adding a debugging `console.log` and leaving it behind is far too easy.

## 12. Testing strategy

| Layer | Tooling | Coverage |
|---|---|---|
| Unit | Vitest | `domain` and `crypto`: deadline resolver, allocation, key envelope. Pure and fast. |
| Integration | Vitest + Testcontainers | NestJS modules against real PostgreSQL, so constraints and views are genuinely exercised rather than mocked. |
| End-to-end | Playwright | Critical flows, including vault unlock **with the network disabled**, in both locales. |

GitHub Actions runs on every push: lint, type check, all three layers, `i18n:check`,
and image builds. The offline end-to-end test is what prevents the system's
central promise from breaking in a careless refactor.

## 13. Documentation

Maintained alongside the code, not afterwards.

```
README.md                    five-minute setup
docs/architecture.md         overview and module boundaries
docs/operations.md           runbook: backup, restore, update, rollback
docs/security-model.md       what the vault protects and what it does not
docs/fiscal-catalog.md       generated obligation table with legal references
docs/adr/NNNN-*.md           decisions and their reasoning
docs/superpowers/specs/      per-phase specifications
```

`fiscal-catalog.md` is generated from the catalog source, so it cannot drift.

## 14. Phasing

Each phase delivers something usable and gets its own specification and
implementation plan.

| Phase | Delivers | Standalone value |
|---|---|---|
| **0 — Foundation** | Monorepo, CI, Docker, Tailscale, authentication, company and individual clients with fiscal profiles, employment links, installable PWA, i18n infrastructure | Client and staff register accessible on the phone |
| **1 — Vault** | Crypto, platforms, credentials, offline access, TOTP, recovery | Replaces the current method of storing access details |
| **2 — Obligations** | Catalog, resolver, generator, deadline dashboard | Deadlines no longer depend on memory |
| **3 — Billing** | Plans, charges, payments, allocation, client ledger | Answers who owes what, and for how long |
| **4 — Consolidation** | Cross-module reporting, global search, ergonomics | Refinement driven by real use |

Phase 1 precedes obligations deliberately. It delivers daily value from the
first day and is the most delicate part technically; built early, it accumulates
real-world use before the system grows large.

Employment lives in Phase 0 because it touches the core `Client` model. Its two
downstream capabilities then arrive with no further work on the relationship
itself: personal credentials in Phase 1, because the vault is already keyed by
client; personal obligations in Phase 2, because the engine already reads the
client kind and fiscal profile.

## 15. Risks

| Risk | Mitigation |
|---|---|
| Fiscal catalog inaccurate or outdated | Owner reviews line by line; rules are five-line data entries with validity dates and tests |
| Master password and recovery code both lost | Forced acknowledgement at setup; paper storage off-site; documented in the security model |
| Office machine failure | Encrypted off-site backups; documented restore procedure; quarterly drill |
| Server compromise defeating zero-knowledge | Not internet-exposed; strict CSP; no third-party scripts; dependency auditing |
| Argon2id parameters too heavy for mobile | Fixed at 64 MiB; verified on iOS Safari during Phase 1 |
| Cached credentials shown stale after rotation | Permanent sync-status indicator; cursor-based delta sync on startup |

## 16. Open questions

1. Should retainer amounts separate taxable base from VAT? Current assumption is
   a single gross figure (section 8.1).
2. Should completed obligations support file attachments (submission receipts)?
   Deferred to Phase 4 unless raised earlier.
