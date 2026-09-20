# Phase 2 — Obligations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a fiscal-obligation engine — a Portuguese tax/social-security catalog, a pure resolver that computes statutory deadlines, an idempotent generator, manual adjustment, and a deadline dashboard — replacing the practice's current dependence on memory for what is due and when.

**Architecture:** Extends the Phase 0/1 monorepo. `packages/domain` gains `src/obligations/` (catalog, resolver, holiday calendar, pure grouping) plus the usual enums/schemas. A new `obligations` API module owns generation (dry-run and apply, driven by a NestJS-first-ever in-process cron), listing, and manual adjustment. The browser gains a home-page dashboard and a per-client section, both reading one flexible list endpoint and sharing one pure grouping function — no server-side "dashboard shape" endpoint to keep in sync with a second one.

**Tech Stack:** Same as Phase 0/1 (TypeScript 6.0, Node 24, NestJS 12, Prisma 7, PostgreSQL 18, React 19.2, Vite 8, Vitest 5, Testcontainers, Playwright) plus `@nestjs/schedule` 6 — the first in-process cron in this codebase (the existing backup job runs from the host's crontab, outside the application; this phase's generator explicitly does not).

**Spec:** `docs/superpowers/specs/2026-09-04-ledger-hq-design.md` (sections 5.2, 6.5, 7, 10.5, 14) and `docs/superpowers/specs/2026-09-12-phase-2-obligations-design.md` (this phase's own design — the decisions the master spec leaves open)

## Decisions this plan makes that the design doc leaves open

- **`ObligationDefinition` rows are upserted by the generator itself, not seeded by migration.** The design doc calls the table "a seeded mirror" without saying when the seeding happens. A migration-time seed (like `Platform`'s three fixed rows in Phase 1) would drift the moment a catalog file gains a new code without a new migration. Instead, every generator run's first step is `syncCatalogDefinitions()`: upsert one `ObligationDefinition` row per catalog entry, keyed by `code`. Idempotent, and the table never needs to be kept in sync with the catalog file by hand.
- **`POST /obligations/generate` accepts an optional `clientId` to scope both dry-run and apply to one client.** The master spec's generator is described as sweeping "each active client"; the design doc's "preview after a fiscal-profile save" trigger is inherently about *one* client's profile just having changed. Rather than a system-wide dry-run every time one profile is saved, `clientId` narrows the sweep to that client when provided, and is omitted for the daily cron's full sweep.
- **`VAT_PAYMENT`, listed once in the master spec's table, becomes two codes** (`VAT_PAYMENT_MONTHLY`/`VAT_PAYMENT_QUARTERLY`), mirroring the exact split its sibling `VAT_MONTHLY_RETURN`/`VAT_QUARTERLY_RETURN` already needed — a client's VAT payment obligation follows whichever regime their return does, and a single code conditioned on `hasOpenActivity` alone would double-fire for a client in either regime.
- **`POST /obligations/generate` defaults to a dry run when `dryRun` is omitted or malformed**, not to applying — the safer of the two on an endpoint that writes data. The web client (Task 13) always sends the query param explicitly; this default only matters for a raw API call that forgets it.
- **`CIT_PAYMENT_ON_ACCOUNT`, described in the master spec as three dates ("July, September, 15 December") under one code, becomes three separate `ANNUAL` catalog entries** (`CIT_PAYMENT_ON_ACCOUNT_1`/`_2`/`_3`) rather than one code with three deadlines. `ObligationInstance` has exactly one `dueDate`; three genuinely different statutory deadlines need three rows, the same way `VAT_MONTHLY_RETURN`/`VAT_QUARTERLY_RETURN` are already two codes rather than one "VAT return, periodicity varies" code.
- **The three `CIT_PAYMENT_ON_ACCOUNT_*` July/September dates, not given as exact days in the master spec's table, are encoded as the last day of July and September respectively** (`fixedDate` entries, `yearsAfter: 0` — the annual period's own year, not the year after), flagged in the catalog's own code comment for the owner's line-by-line review (design doc section 3.1) — the same review gate every other rule in this table goes through.
- **A third `DeadlineRule` kind, `lastDayOfMonthAfterPeriodEnd`, joins the two the design doc's resolver section implies** (`dayOfMonthAfterPeriodEnd`, `fixedDate`). `MODEL_30_NON_RESIDENT_PAYMENTS`'s "end of the 2nd following month" cannot be expressed as a fixed day-of-month — the 2nd-following month's last day is the 28th, 29th, 30th or 31st depending which month it is — and reusing `dayOfMonthAfterPeriodEnd` with `day: 31` would silently roll over into the next month whenever the target month has fewer than 31 days (`Date.UTC`'s own overflow behavior), producing a wrong date instead of a validation error. One rule needing this is enough to justify the primitive; it costs one more resolver branch, not a second module.
- **`MODEL_3_PIT_RETURN`'s "1 April to 30 June" filing window becomes a single `dueDate` of 30 June** (the closing date, which is what "late" is measured against) rather than a tracked window — `ObligationInstance` has one `dueDate` column, consistent with every other rule.
- **Holiday calculation uses plain UTC `Date` arithmetic, no new date library.** Every date in this feature is a calendar date with no time-of-day (`@db.Date` columns, `isoDateSchema`'s own convention already established in Phase 0), so DST and timezone conversion never enter the picture — the existing codebase already manipulates calendar dates this way (`new Date(\`${value}T00:00:00Z\`)` in `clients.service.ts`, `fiscal-profiles.service.ts`).

## Global Constraints

Every task inherits these, plus everything in Phase 0/1's Global Constraints
(language, money, dates, identifiers, deletion, error contract, locales, KDF
parameters, secrets-never-logged, module boundaries, TDD). New for this phase:

- **The resolver has no I/O and never calls `Date.now()`.** The current date
  is always a parameter (`appliesTo`, `generatePeriods`, `resolveDueDate`,
  the generator's `asOf`). This is what makes deadline computation testable
  against fixed calendar dates instead of "whatever day the test happened to
  run."
- **The generator is idempotent, never touches non-`PENDING` instances,
  never rewrites the past (`periodEnd >= asOf - 3 months`), and retracts
  forward only** — the four invariants from master spec 7.3, unconditional.
- **`appliesWhen` is data, not a predicate function**, for every catalog
  entry, including ad-hoc ones created through the UI — master spec 7.1's
  own reasoning (inspectable rules, a UI that can explain "applies because
  ...") applies equally to a `CUSTOM` definition.
- **Every catalog entry carries `validFrom`/`validTo` and its own inline
  `i18n: { pt, en }` block** — never routed through the locale JSON files
  (master spec 10.5: the legal designation and its translation are one unit
  of review).
- **`WAIVED` requires a non-empty `notes`** — a dispensed obligation with no
  justification is not an audit trail, it is a hole in one.
- **Obligation data (catalog metadata, instance status/dates) is plaintext
  by design, like the platform catalog in Phase 1** — no vault unlock gate
  anywhere in this feature.

---

### Task 1: Domain enums and error codes

**Files:**
- Modify: `packages/domain/src/enums.ts`
- Modify: `packages/domain/src/errors.ts`
- Create: `packages/domain/src/enums.test.ts` (if it doesn't already exist — check first; if it does, extend it)

**Interfaces:**
- Consumes: nothing new.
- Produces (consumed by every later task in this plan):
  - `AUTHORITY_VALUES`, `Authority`
  - `PERIODICITY_VALUES`, `Periodicity`
  - `OBLIGATION_STATUS_VALUES`, `ObligationStatus`
  - `DEFINITION_SOURCE_VALUES`, `DefinitionSource`
  - Two new `ErrorCode` members: `'obligations.waived_reason_required'`, `'obligations.definition_code_taken'`

- [ ] **Step 1: Check for an existing `enums.test.ts`**

Run: `ls packages/domain/src/enums.test.ts 2>/dev/null || echo "no existing file"`

If it exists, read it fully before Step 2 so your additions match its style and you extend rather than replace it. If it doesn't exist, Step 2 creates it fresh.

- [ ] **Step 2: Write the enum tests**

Add to `packages/domain/src/enums.test.ts` (create the file with this content if none exists; otherwise append these `describe` blocks):

```ts
import { describe, expect, it } from 'vitest'
import {
  AUTHORITY_VALUES,
  DEFINITION_SOURCE_VALUES,
  OBLIGATION_STATUS_VALUES,
  PERIODICITY_VALUES,
} from './enums'

describe('obligation enums', () => {
  it('AUTHORITY_VALUES has the four authorities the master spec names', () => {
    expect(AUTHORITY_VALUES).toEqual(['TAX', 'SOCIAL_SECURITY', 'REGISTRY', 'OTHER'])
  })

  it('PERIODICITY_VALUES has the four periodicities', () => {
    expect(PERIODICITY_VALUES).toEqual(['MONTHLY', 'QUARTERLY', 'ANNUAL', 'ONE_OFF'])
  })

  it('OBLIGATION_STATUS_VALUES has the four statuses', () => {
    expect(OBLIGATION_STATUS_VALUES).toEqual(['PENDING', 'IN_PROGRESS', 'DONE', 'WAIVED'])
  })

  it('DEFINITION_SOURCE_VALUES distinguishes catalog from user-created', () => {
    expect(DEFINITION_SOURCE_VALUES).toEqual(['CATALOG', 'CUSTOM'])
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/domain test -- enums`
Expected: FAIL — none of the four exports exist yet.

- [ ] **Step 4: Add the four enums**

Add to `packages/domain/src/enums.ts` (at the end of the file, after `AUTH_KIND_VALUES`):

```ts
export const AUTHORITY_VALUES = ['TAX', 'SOCIAL_SECURITY', 'REGISTRY', 'OTHER'] as const
export type Authority = (typeof AUTHORITY_VALUES)[number]

export const PERIODICITY_VALUES = ['MONTHLY', 'QUARTERLY', 'ANNUAL', 'ONE_OFF'] as const
export type Periodicity = (typeof PERIODICITY_VALUES)[number]

export const OBLIGATION_STATUS_VALUES = ['PENDING', 'IN_PROGRESS', 'DONE', 'WAIVED'] as const
export type ObligationStatus = (typeof OBLIGATION_STATUS_VALUES)[number]

export const DEFINITION_SOURCE_VALUES = ['CATALOG', 'CUSTOM'] as const
export type DefinitionSource = (typeof DEFINITION_SOURCE_VALUES)[number]
```

- [ ] **Step 5: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/domain test -- enums`
Expected: PASS.

- [ ] **Step 6: Add the two new error codes**

Add to `packages/domain/src/errors.ts`'s `ERROR_CODES` array, immediately before the closing `] as const`:

```ts
  'obligations.waived_reason_required',
  'obligations.definition_code_taken',
```

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/domain typecheck && pnpm --filter @ledger-hq/domain lint`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/enums.ts packages/domain/src/enums.test.ts packages/domain/src/errors.ts
git commit -m "feat(domain): add obligation enums and error codes"
```

---

### Task 2: Holiday calendar

**Files:**
- Create: `packages/domain/src/obligations/holidays.ts`
- Create: `packages/domain/src/obligations/holidays.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (consumed by Task 3's resolver):
  - `isPublicHoliday(date: Date): boolean`
  - `isWeekend(date: Date): boolean`
  - `nextBusinessDay(date: Date): Date`

All dates in this module are UTC-midnight `Date` values representing a
calendar date with no time component — the same convention `isoDateSchema`
and every `@db.Date` column already use elsewhere in this codebase. Every
function in this file takes a `Date` and returns a new `Date`; none mutates
its argument, and none calls `Date.now()`.

- [ ] **Step 1: Write the holiday tests**

`packages/domain/src/obligations/holidays.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isPublicHoliday, isWeekend, nextBusinessDay } from './holidays'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

describe('isPublicHoliday', () => {
  it('recognises every fixed national holiday', () => {
    const fixed: Array<[number, number]> = [
      [1, 1], // Ano Novo
      [4, 25], // Dia da Liberdade
      [5, 1], // Dia do Trabalhador
      [6, 10], // Dia de Portugal
      [8, 15], // Assunção de Nossa Senhora
      [10, 5], // Implantação da República
      [11, 1], // Todos os Santos
      [12, 1], // Restauração da Independência
      [12, 8], // Imaculada Conceição
      [12, 25], // Natal
    ]

    for (const [month, day] of fixed) {
      expect(isPublicHoliday(utc(2026, month, day))).toBe(true)
    }
  })

  it('recognises Good Friday and Corpus Christi for a known Easter year', () => {
    // Easter Sunday 2026 is 5 April 2026 (verified via the anonymous
    // Gregorian computus algorithm, independently of this module).
    expect(isPublicHoliday(utc(2026, 4, 3))).toBe(true) // Good Friday = Easter - 2 days
    expect(isPublicHoliday(utc(2026, 6, 4))).toBe(true) // Corpus Christi = Easter + 60 days
  })

  it('does not treat an ordinary day as a holiday', () => {
    expect(isPublicHoliday(utc(2026, 3, 17))).toBe(false)
  })

  it('does not treat a municipal holiday as national', () => {
    // Deliberately excluded per the master spec (section 7.2): tax deadlines
    // are national, municipal holidays are not observed by this calendar.
    // 13 June (Santo António) is a Lisbon municipal holiday, not national.
    expect(isPublicHoliday(utc(2026, 6, 13))).toBe(false)
  })
})

describe('isWeekend', () => {
  it('recognises Saturday and Sunday', () => {
    expect(isWeekend(utc(2026, 3, 21))).toBe(true) // Saturday
    expect(isWeekend(utc(2026, 3, 22))).toBe(true) // Sunday
  })

  it('does not treat a weekday as a weekend', () => {
    expect(isWeekend(utc(2026, 3, 18))).toBe(false) // Wednesday
  })
})

describe('nextBusinessDay', () => {
  it('leaves a weekday that is not a holiday unchanged', () => {
    const day = utc(2026, 3, 18)
    expect(nextBusinessDay(day)).toEqual(day)
  })

  it('shifts a Saturday forward to Monday', () => {
    expect(nextBusinessDay(utc(2026, 3, 21))).toEqual(utc(2026, 3, 23))
  })

  it('shifts a Sunday forward to Monday', () => {
    expect(nextBusinessDay(utc(2026, 3, 22))).toEqual(utc(2026, 3, 23))
  })

  it('shifts a holiday forward, skipping a weekend it lands next to', () => {
    // 25 April 2026 is a Saturday; the holiday and the weekend chain shift
    // together to Monday 27 April.
    expect(nextBusinessDay(utc(2026, 4, 25))).toEqual(utc(2026, 4, 27))
  })

  it('shifts across consecutive holidays', () => {
    // 1 November 2026 (Todos os Santos) is a Sunday; next business day is
    // Monday 2 November, an ordinary day.
    expect(nextBusinessDay(utc(2026, 11, 1))).toEqual(utc(2026, 11, 2))
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/domain test -- holidays`
Expected: FAIL — `./holidays` does not exist.

- [ ] **Step 3: Implement the holiday calendar**

`packages/domain/src/obligations/holidays.ts`:

```ts
const FIXED_HOLIDAYS: ReadonlyArray<readonly [month: number, day: number]> = [
  [1, 1], // Ano Novo
  [4, 25], // Dia da Liberdade
  [5, 1], // Dia do Trabalhador
  [6, 10], // Dia de Portugal
  [8, 15], // Assunção de Nossa Senhora
  [10, 5], // Implantação da República
  [11, 1], // Todos os Santos
  [12, 1], // Restauração da Independência
  [12, 8], // Imaculada Conceição
  [12, 25], // Natal
]

/**
 * The anonymous Gregorian algorithm (Meeus/Jones/Butcher) for the date of
 * Easter Sunday. Returns a UTC-midnight `Date`. Verified against the known
 * 2026 date (5 April) in this module's own test file.
 */
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1

  return new Date(Date.UTC(year, month - 1, day))
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime())
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

/** Good Friday and Corpus Christi, the two Easter-derived national holidays this calendar observes. */
function movableHolidays(year: number): Date[] {
  const easter = easterSunday(year)
  return [addDays(easter, -2), addDays(easter, 60)]
}

/**
 * National holidays only — municipal holidays (Santo António, São João, ...)
 * are deliberately excluded, per the master spec (section 7.2): tax
 * deadlines are national.
 */
export function isPublicHoliday(date: Date): boolean {
  const year = date.getUTCFullYear()

  for (const [month, day] of FIXED_HOLIDAYS) {
    if (date.getUTCMonth() + 1 === month && date.getUTCDate() === day) return true
  }

  return movableHolidays(year).some((holiday) => sameCalendarDay(holiday, date))
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

/** Shifts forward one day at a time until landing on a weekday that is not a holiday. */
export function nextBusinessDay(date: Date): Date {
  let candidate = date
  while (isWeekend(candidate) || isPublicHoliday(candidate)) {
    candidate = addDays(candidate, 1)
  }
  return candidate
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/domain test -- holidays`
Expected: PASS, all cases green.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/domain typecheck && pnpm --filter @ledger-hq/domain lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/obligations/holidays.ts packages/domain/src/obligations/holidays.test.ts
git commit -m "feat(domain): add the Portuguese national holiday calendar"
```

---

### Task 3: Catalog types and the resolver

**Files:**
- Create: `packages/domain/src/obligations/catalog-types.ts`
- Create: `packages/domain/src/obligations/resolver.ts`
- Create: `packages/domain/src/obligations/resolver.test.ts`

**Interfaces:**
- Consumes: `isPublicHoliday`, `nextBusinessDay` (Task 2); `ClientKind`, `VatRegime`, `IncomeTax`, `Authority`, `Periodicity` (Task 1 and Phase 0's `enums.ts`).
- Produces (consumed by Tasks 4-6's catalog files, and by Task 9's generator):
  - `Condition`, `ConditionGroup`, `DeadlineRule`, `ObligationSubject`, `CatalogEntry`, `Period` (types)
  - `appliesTo(definition: CatalogEntry, subject: ObligationSubject): boolean`
  - `generatePeriods(periodicity: Periodicity, from: Date, to: Date): Period[]`
  - `resolveDueDate(definition: Pick<CatalogEntry, 'deadline' | 'businessDayShift'>, period: Period): Date`

`appliesTo` deliberately takes only `(definition, subject)`, not the three-argument
`(definition, subject, period)` shape the master spec's own pseudocode sketches
in section 7.2 — none of this phase's 14 catalog entries has a condition that
depends on which period is being evaluated (they all test the client's kind
and current fiscal-profile fields), and `validFrom`/`validTo` rule-version
selection is a separate check the generator (Task 9) makes directly against
`period.end`, not something `appliesTo` itself needs to know. A future
period-dependent condition is exactly the kind of change that would add the
parameter back; YAGNI says not to carry it unused today.

- [ ] **Step 1: Write the catalog types**

`packages/domain/src/obligations/catalog-types.ts`:

```ts
import type { Authority, ClientKind, IncomeTax, Periodicity, VatRegime } from '../enums'

export type Condition =
  | { field: 'kind'; op: 'eq'; value: ClientKind }
  | { field: 'vatRegime'; op: 'eq'; value: VatRegime }
  | { field: 'incomeTax'; op: 'eq'; value: IncomeTax }
  | {
      field: 'hasOpenActivity' | 'hasEmployees' | 'hasWithholding' | 'isVatCashBasis'
      op: 'eq'
      value: boolean
    }

export type ConditionGroup = { all: Condition[] }

export type DeadlineRule =
  | { kind: 'dayOfMonthAfterPeriodEnd'; day: number; monthsAfter: number }
  | { kind: 'fixedDate'; month: number; day: number; yearsAfter: number }
  | { kind: 'lastDayOfMonthAfterPeriodEnd'; monthsAfter: number }

/** The flattened subject `appliesWhen` conditions are evaluated against — the client's kind plus its fiscal profile, as one object (master spec 7.1). */
export type ObligationSubject = {
  kind: ClientKind
  hasOpenActivity: boolean
  vatRegime: VatRegime
  incomeTax: IncomeTax
  hasEmployees: boolean
  hasWithholding: boolean
  isVatCashBasis: boolean
}

export type CatalogEntry = {
  code: string
  authority: Authority
  periodicity: Periodicity
  legalRef: string
  appliesWhen: ConditionGroup
  deadline: DeadlineRule
  businessDayShift: 'NEXT'
  validFrom: string
  validTo: string | null
  i18n: { pt: { name: string; description: string }; en: { name: string; description: string } }
}

export type Period = { start: Date; end: Date; label: string }
```

- [ ] **Step 2: Write the resolver tests**

`packages/domain/src/obligations/resolver.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { appliesTo, generatePeriods, resolveDueDate } from './resolver'
import type { CatalogEntry, ObligationSubject, Period } from './catalog-types'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

function period(start: [number, number, number], end: [number, number, number], label: string): Period {
  return { start: utc(...start), end: utc(...end), label }
}

const companySubject: ObligationSubject = {
  kind: 'COMPANY',
  hasOpenActivity: true,
  vatRegime: 'MONTHLY',
  incomeTax: 'CIT',
  hasEmployees: true,
  hasWithholding: false,
  isVatCashBasis: false,
}

describe('appliesTo', () => {
  it('matches when every condition in "all" is satisfied', () => {
    const definition = {
      appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'COMPANY' }, { field: 'hasEmployees', op: 'eq', value: true }] },
    } as Pick<CatalogEntry, 'appliesWhen'>

    expect(appliesTo(definition as CatalogEntry, companySubject)).toBe(true)
  })

  it('fails when any condition in "all" is not satisfied', () => {
    const definition = {
      appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'INDIVIDUAL' }] },
    } as Pick<CatalogEntry, 'appliesWhen'>

    expect(appliesTo(definition as CatalogEntry, companySubject)).toBe(false)
  })

  it('matches an empty condition list unconditionally', () => {
    const definition = { appliesWhen: { all: [] } } as Pick<CatalogEntry, 'appliesWhen'>
    expect(appliesTo(definition as CatalogEntry, companySubject)).toBe(true)
  })
})

describe('generatePeriods', () => {
  it('MONTHLY: one period per calendar month, label and boundaries correct', () => {
    const periods = generatePeriods('MONTHLY', utc(2026, 1, 1), utc(2026, 2, 28))
    expect(periods).toEqual([
      { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' },
      { start: utc(2026, 2, 1), end: utc(2026, 2, 28), label: '2026-02' },
    ])
  })

  it('MONTHLY: a leap-year February has 29 days', () => {
    const periods = generatePeriods('MONTHLY', utc(2028, 2, 1), utc(2028, 2, 29))
    expect(periods).toEqual([{ start: utc(2028, 2, 1), end: utc(2028, 2, 29), label: '2028-02' }])
  })

  it('QUARTERLY: one period per quarter, label uses the Q-notation', () => {
    const periods = generatePeriods('QUARTERLY', utc(2026, 1, 1), utc(2026, 6, 30))
    expect(periods).toEqual([
      { start: utc(2026, 1, 1), end: utc(2026, 3, 31), label: '2026-Q1' },
      { start: utc(2026, 4, 1), end: utc(2026, 6, 30), label: '2026-Q2' },
    ])
  })

  it('ANNUAL: one period per calendar year', () => {
    const periods = generatePeriods('ANNUAL', utc(2025, 6, 1), utc(2026, 6, 1))
    expect(periods).toEqual([
      { start: utc(2025, 1, 1), end: utc(2025, 12, 31), label: '2025' },
      { start: utc(2026, 1, 1), end: utc(2026, 12, 31), label: '2026' },
    ])
  })

  it('ONE_OFF: never generates a period — ad-hoc obligations are created directly, not swept', () => {
    expect(generatePeriods('ONE_OFF', utc(2026, 1, 1), utc(2026, 12, 31))).toEqual([])
  })
})

describe('resolveDueDate', () => {
  it('dayOfMonthAfterPeriodEnd: no shift needed when the raw date is a business day', () => {
    // Period January 2026, day 20, 2 months after → 20 March 2026 (a Friday).
    const definition = { deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 20, monthsAfter: 2 }, businessDayShift: 'NEXT' } as const
    const p = period([2026, 1, 1], [2026, 1, 31], '2026-01')

    expect(resolveDueDate(definition, p)).toEqual(utc(2026, 3, 20))
  })

  it('dayOfMonthAfterPeriodEnd: shifts a Saturday forward to Monday', () => {
    // 21 March 2026 is a Saturday.
    const definition = { deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 21, monthsAfter: 0 }, businessDayShift: 'NEXT' } as const
    const p = period([2026, 3, 1], [2026, 3, 31], '2026-03')

    expect(resolveDueDate(definition, p)).toEqual(utc(2026, 3, 23))
  })

  it('fixedDate: shifts a date that is both a Saturday and a national holiday', () => {
    // 25 April 2026 (Dia da Liberdade) is a Saturday; next business day is Monday 27 April.
    const definition = { deadline: { kind: 'fixedDate', month: 4, day: 25, yearsAfter: 0 }, businessDayShift: 'NEXT' } as const
    const p = period([2026, 1, 1], [2026, 1, 31], '2026-01')

    expect(resolveDueDate(definition, p)).toEqual(utc(2026, 4, 27))
  })

  it('fixedDate: yearsAfter shifts the deadline to a following year', () => {
    const definition = { deadline: { kind: 'fixedDate', month: 5, day: 31, yearsAfter: 1 }, businessDayShift: 'NEXT' } as const
    const p = period([2025, 1, 1], [2025, 12, 31], '2025')

    // 31 May 2026 is a Sunday; next business day is Monday 1 June 2026.
    expect(resolveDueDate(definition, p)).toEqual(utc(2026, 6, 1))
  })

  it('lastDayOfMonthAfterPeriodEnd: resolves to the actual last day of a short month, not a fixed day-of-month', () => {
    // Period April 2026 (30 days), 2 months after → June 2026, which also
    // has 30 days — chosen so the test cannot pass by coincidentally
    // matching a hardcoded day-of-month like 31.
    const definition = { deadline: { kind: 'lastDayOfMonthAfterPeriodEnd', monthsAfter: 2 }, businessDayShift: 'NEXT' } as const
    const p = period([2026, 4, 1], [2026, 4, 30], '2026-04')

    // 30 June 2026 is a Tuesday — no shift needed.
    expect(resolveDueDate(definition, p)).toEqual(utc(2026, 6, 30))
  })

  it('lastDayOfMonthAfterPeriodEnd: a 31-day target month is not truncated to 30', () => {
    const definition = { deadline: { kind: 'lastDayOfMonthAfterPeriodEnd', monthsAfter: 1 }, businessDayShift: 'NEXT' } as const
    const p = period([2026, 6, 1], [2026, 6, 30], '2026-06')

    // 31 July 2026 is a Friday — no shift needed.
    expect(resolveDueDate(definition, p)).toEqual(utc(2026, 7, 31))
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/domain test -- resolver`
Expected: FAIL — `./resolver` does not exist.

- [ ] **Step 4: Implement the resolver**

`packages/domain/src/obligations/resolver.ts`:

```ts
import { nextBusinessDay } from './holidays'
import type { CatalogEntry, ObligationSubject, Period } from './catalog-types'

/**
 * `subject` is a plain object keyed by every field a condition can name;
 * reading it dynamically by `condition.field` is safe (every `Condition`
 * variant's `field` is one of `ObligationSubject`'s own keys) but not
 * something the type checker can verify across a discriminated union, hence
 * the one narrow cast.
 */
export function appliesTo(definition: CatalogEntry, subject: ObligationSubject): boolean {
  return definition.appliesWhen.all.every((condition) => {
    const actual = (subject as unknown as Record<string, unknown>)[condition.field]
    return actual === condition.value
  })
}

export function generatePeriods(
  periodicity: CatalogEntry['periodicity'],
  from: Date,
  to: Date,
): Period[] {
  switch (periodicity) {
    case 'MONTHLY':
      return monthlyPeriods(from, to)
    case 'QUARTERLY':
      return quarterlyPeriods(from, to)
    case 'ANNUAL':
      return annualPeriods(from, to)
    case 'ONE_OFF':
      return []
  }
}

function monthlyPeriods(from: Date, to: Date): Period[] {
  const periods: Period[] = []
  let year = from.getUTCFullYear()
  let month = from.getUTCMonth()

  for (;;) {
    const start = new Date(Date.UTC(year, month, 1))
    if (start > to) break

    const end = new Date(Date.UTC(year, month + 1, 0))
    if (end >= from) {
      periods.push({ start, end, label: `${year}-${String(month + 1).padStart(2, '0')}` })
    }

    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
  }

  return periods
}

function quarterlyPeriods(from: Date, to: Date): Period[] {
  const periods: Period[] = []
  let year = from.getUTCFullYear()
  let quarter = Math.floor(from.getUTCMonth() / 3)

  for (;;) {
    const startMonth = quarter * 3
    const start = new Date(Date.UTC(year, startMonth, 1))
    if (start > to) break

    const end = new Date(Date.UTC(year, startMonth + 3, 0))
    if (end >= from) {
      periods.push({ start, end, label: `${year}-Q${quarter + 1}` })
    }

    quarter += 1
    if (quarter > 3) {
      quarter = 0
      year += 1
    }
  }

  return periods
}

function annualPeriods(from: Date, to: Date): Period[] {
  const periods: Period[] = []
  let year = from.getUTCFullYear()

  for (;;) {
    const start = new Date(Date.UTC(year, 0, 1))
    if (start > to) break

    const end = new Date(Date.UTC(year, 11, 31))
    if (end >= from) {
      periods.push({ start, end, label: `${year}` })
    }

    year += 1
  }

  return periods
}

export function resolveDueDate(
  definition: Pick<CatalogEntry, 'deadline' | 'businessDayShift'>,
  period: Period,
): Date {
  const { deadline } = definition

  const raw =
    deadline.kind === 'dayOfMonthAfterPeriodEnd'
      ? addMonthsAndSetDay(period.end, deadline.monthsAfter, deadline.day)
      : deadline.kind === 'lastDayOfMonthAfterPeriodEnd'
        ? lastDayOfMonthsAfter(period.end, deadline.monthsAfter)
        : new Date(Date.UTC(period.end.getUTCFullYear() + deadline.yearsAfter, deadline.month - 1, deadline.day))

  return definition.businessDayShift === 'NEXT' ? nextBusinessDay(raw) : raw
}

function addMonthsAndSetDay(periodEnd: Date, monthsAfter: number, day: number): Date {
  const totalMonths = periodEnd.getUTCMonth() + monthsAfter
  const year = periodEnd.getUTCFullYear() + Math.floor(totalMonths / 12)
  const month = totalMonths % 12
  return new Date(Date.UTC(year, month, day))
}

/** Day 0 of the month after the target month is JavaScript's own idiom for "the last day of the target month" — it never overflows into the month beyond, unlike setting a fixed day-of-month such as 31. */
function lastDayOfMonthsAfter(periodEnd: Date, monthsAfter: number): Date {
  const totalMonths = periodEnd.getUTCMonth() + monthsAfter
  const year = periodEnd.getUTCFullYear() + Math.floor(totalMonths / 12)
  const month = totalMonths % 12
  return new Date(Date.UTC(year, month + 1, 0))
}
```

- [ ] **Step 5: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/domain test -- resolver`
Expected: PASS, all cases green.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/domain typecheck && pnpm --filter @ledger-hq/domain lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/obligations/catalog-types.ts packages/domain/src/obligations/resolver.ts packages/domain/src/obligations/resolver.test.ts
git commit -m "feat(domain): add the obligation catalog types and the pure resolver"
```

---

### Task 4: The shared urgency-grouping function

**Files:**
- Create: `packages/domain/src/obligations/group-by-urgency.ts`
- Create: `packages/domain/src/obligations/group-by-urgency.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks in this package (a self-contained pure function; only needs the `dueDate` field any obligation-shaped object carries).
- Produces (consumed by `apps/web`'s `ObligationsDashboard` and `ObligationsSection`, Tasks 15-16 — the one grouping implementation both screens share, so there is never a second one to keep in sync):
  - `UrgencyGroup` (`'overdue' | 'thisWeek' | 'thisMonth' | 'later'`)
  - `groupByUrgency<T extends { dueDate: string }>(items: T[], today: Date): Record<UrgencyGroup, T[]>`

This function takes `today` as a parameter and never calls `Date.now()`,
the same discipline the resolver (Task 3) already follows, for the same
reason: a grouping function that silently depends on the wall clock cannot
be tested against a fixed date.

- [ ] **Step 1: Write the grouping tests**

`packages/domain/src/obligations/group-by-urgency.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { groupByUrgency } from './group-by-urgency'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

type Item = { id: string; dueDate: string }

describe('groupByUrgency', () => {
  const today = utc(2026, 3, 18) // a Wednesday

  it('buckets an overdue item', () => {
    const items: Item[] = [{ id: 'a', dueDate: '2026-03-01' }]
    expect(groupByUrgency(items, today).overdue).toEqual(items)
  })

  it('buckets an item due today as this week, not overdue', () => {
    const items: Item[] = [{ id: 'a', dueDate: '2026-03-18' }]
    expect(groupByUrgency(items, today).thisWeek).toEqual(items)
    expect(groupByUrgency(items, today).overdue).toEqual([])
  })

  it('buckets an item due within 7 days as this week', () => {
    const items: Item[] = [{ id: 'a', dueDate: '2026-03-20' }]
    expect(groupByUrgency(items, today).thisWeek).toEqual(items)
  })

  it('buckets an item due later in the same month as this month', () => {
    const items: Item[] = [{ id: 'a', dueDate: '2026-03-28' }]
    expect(groupByUrgency(items, today).thisMonth).toEqual(items)
  })

  it('buckets an item due next month as later', () => {
    const items: Item[] = [{ id: 'a', dueDate: '2026-04-05' }]
    expect(groupByUrgency(items, today).later).toEqual(items)
  })

  it('sorts each bucket by due date ascending', () => {
    const items: Item[] = [
      { id: 'later', dueDate: '2026-03-30' },
      { id: 'earlier', dueDate: '2026-03-27' },
    ]
    expect(groupByUrgency(items, today).thisMonth.map((item) => item.id)).toEqual(['earlier', 'later'])
  })

  it('returns all four keys even when every bucket is empty', () => {
    expect(groupByUrgency([], today)).toEqual({ overdue: [], thisWeek: [], thisMonth: [], later: [] })
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/domain test -- group-by-urgency`
Expected: FAIL — `./group-by-urgency` does not exist.

- [ ] **Step 3: Implement the grouping function**

`packages/domain/src/obligations/group-by-urgency.ts`:

```ts
export type UrgencyGroup = 'overdue' | 'thisWeek' | 'thisMonth' | 'later'

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime())
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function endOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
}

/**
 * Buckets obligations by urgency relative to `today`: overdue (due date
 * before today), this week (today through 6 days out), this month (the rest
 * of the current calendar month), or later. Each bucket is sorted by due
 * date ascending. Shared by the global dashboard and the per-client
 * section — one grouping implementation, not a second one per screen.
 */
export function groupByUrgency<T extends { dueDate: string }>(
  items: T[],
  today: Date,
): Record<UrgencyGroup, T[]> {
  const todayUtc = startOfUtcDay(today)
  const weekEnd = addDays(todayUtc, 7)
  const monthEnd = endOfUtcMonth(todayUtc)

  const groups: Record<UrgencyGroup, T[]> = { overdue: [], thisWeek: [], thisMonth: [], later: [] }

  for (const item of items) {
    const due = parseIsoDate(item.dueDate)

    if (due < todayUtc) groups.overdue.push(item)
    else if (due < weekEnd) groups.thisWeek.push(item)
    else if (due <= monthEnd) groups.thisMonth.push(item)
    else groups.later.push(item)
  }

  for (const key of Object.keys(groups) as UrgencyGroup[]) {
    groups[key].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  }

  return groups
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/domain test -- group-by-urgency`
Expected: PASS, all cases green.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/domain typecheck && pnpm --filter @ledger-hq/domain lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/obligations/group-by-urgency.ts packages/domain/src/obligations/group-by-urgency.test.ts
git commit -m "feat(domain): add the shared urgency-grouping function for obligation lists"
```

---

### Task 5: Fiscal catalog — tax authority rules

**Files:**
- Create: `packages/domain/src/obligations/catalog/tax.ts`
- Create: `packages/domain/src/obligations/catalog/tax.test.ts`

**Interfaces:**
- Consumes: `CatalogEntry`, `ObligationSubject` (Task 3); `resolveDueDate`, `generatePeriods` (Task 3).
- Produces (consumed by Task 6's catalog index, and by Task 9's generator):
  - `TAX_CATALOG: CatalogEntry[]` — 15 entries, all `authority: 'TAX'`.

**Owner review required.** Every entry below is a faithful transcription of
the master spec's initial catalog table (section 7.5) plus this plan's own
resolved ambiguities (see "Decisions this plan makes" at the top of this
document). Two entries — `WITHHOLDING_TAX_PAYMENT` and
`MODEL_10_INCOME_WITHHOLDING` — condition on `hasWithholding: true` rather
than the master table's simplified "company" column, since that field exists
specifically to drive withholding-related rules; this is flagged inline in
the code below for the owner's line-by-line review, same as every deadline
and legal reference in this file.

- [ ] **Step 1: Write the catalog tests**

`packages/domain/src/obligations/catalog/tax.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveDueDate } from '../resolver'
import { TAX_CATALOG } from './tax'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

function findEntry(code: string) {
  const entry = TAX_CATALOG.find((candidate) => candidate.code === code)
  if (!entry) throw new Error(`no catalog entry for ${code}`)
  return entry
}

describe('TAX_CATALOG', () => {
  it('has 15 entries, one per code, no duplicates', () => {
    const codes = TAX_CATALOG.map((entry) => entry.code)
    expect(codes).toHaveLength(15)
    expect(new Set(codes).size).toBe(15)
  })

  it('VAT_MONTHLY_RETURN: 20th of the 2nd following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('VAT_MONTHLY_RETURN'), period)).toEqual(utc(2026, 3, 20))
  })

  it('VAT_QUARTERLY_RETURN: 20th of the 2nd following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 3, 31), label: '2026-Q1' }
    expect(resolveDueDate(findEntry('VAT_QUARTERLY_RETURN'), period)).toEqual(utc(2026, 5, 20))
  })

  it('VAT_PAYMENT_MONTHLY: 25th of the 2nd following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('VAT_PAYMENT_MONTHLY'), period)).toEqual(utc(2026, 3, 25))
  })

  it('VAT_PAYMENT_QUARTERLY: 25th of the 2nd following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 3, 31), label: '2026-Q1' }
    expect(resolveDueDate(findEntry('VAT_PAYMENT_QUARTERLY'), period)).toEqual(utc(2026, 5, 25))
  })

  it('EFATURA_INVOICE_REPORTING: 5th of the following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('EFATURA_INVOICE_REPORTING'), period)).toEqual(utc(2026, 2, 5))
  })

  it('DMR_AT: 10th of the following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('DMR_AT'), period)).toEqual(utc(2026, 2, 10))
  })

  it('WITHHOLDING_TAX_PAYMENT: 20th of the following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('WITHHOLDING_TAX_PAYMENT'), period)).toEqual(utc(2026, 2, 20))
  })

  it('MODEL_22_CIT_RETURN: 31 May, shifted forward when it lands on a Sunday', () => {
    const period = { start: utc(2025, 1, 1), end: utc(2025, 12, 31), label: '2025' }
    // 31 May 2026 is a Sunday; next business day is Monday 1 June 2026.
    expect(resolveDueDate(findEntry('MODEL_22_CIT_RETURN'), period)).toEqual(utc(2026, 6, 1))
  })

  it('IES_ANNUAL_FILING: 15 July', () => {
    const period = { start: utc(2025, 1, 1), end: utc(2025, 12, 31), label: '2025' }
    expect(resolveDueDate(findEntry('IES_ANNUAL_FILING'), period)).toEqual(utc(2026, 7, 15))
  })

  it('CIT_PAYMENT_ON_ACCOUNT_1: last day of July, same year', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 12, 31), label: '2026' }
    expect(resolveDueDate(findEntry('CIT_PAYMENT_ON_ACCOUNT_1'), period)).toEqual(utc(2026, 7, 31))
  })

  it('CIT_PAYMENT_ON_ACCOUNT_2: last day of September, same year', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 12, 31), label: '2026' }
    expect(resolveDueDate(findEntry('CIT_PAYMENT_ON_ACCOUNT_2'), period)).toEqual(utc(2026, 9, 30))
  })

  it('CIT_PAYMENT_ON_ACCOUNT_3: 15 December, same year', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 12, 31), label: '2026' }
    expect(resolveDueDate(findEntry('CIT_PAYMENT_ON_ACCOUNT_3'), period)).toEqual(utc(2026, 12, 15))
  })

  it('MODEL_10_INCOME_WITHHOLDING: 31 January, shifted forward when it lands on a Saturday', () => {
    const period = { start: utc(2025, 1, 1), end: utc(2025, 12, 31), label: '2025' }
    // 31 January 2026 is a Saturday; next business day is Monday 2 February 2026.
    expect(resolveDueDate(findEntry('MODEL_10_INCOME_WITHHOLDING'), period)).toEqual(utc(2026, 2, 2))
  })

  it('MODEL_30_NON_RESIDENT_PAYMENTS: end of the 2nd following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('MODEL_30_NON_RESIDENT_PAYMENTS'), period)).toEqual(utc(2026, 3, 31))
  })

  it('INVENTORY_REPORTING: 31 January, shifted forward when it lands on a Saturday', () => {
    const period = { start: utc(2025, 1, 1), end: utc(2025, 12, 31), label: '2025' }
    expect(resolveDueDate(findEntry('INVENTORY_REPORTING'), period)).toEqual(utc(2026, 2, 2))
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/domain test -- catalog/tax`
Expected: FAIL — `./tax` does not exist.

- [ ] **Step 3: Implement the catalog**

`packages/domain/src/obligations/catalog/tax.ts`:

```ts
import type { CatalogEntry } from '../catalog-types'

const VALID_FROM = '2023-01-01'

export const TAX_CATALOG: CatalogEntry[] = [
  {
    code: 'VAT_MONTHLY_RETURN',
    authority: 'TAX',
    periodicity: 'MONTHLY',
    legalRef: 'CIVA art. 41.º',
    appliesWhen: { all: [{ field: 'hasOpenActivity', op: 'eq', value: true }, { field: 'vatRegime', op: 'eq', value: 'MONTHLY' }] },
    deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 20, monthsAfter: 2 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Declaração periódica de IVA', description: 'Regime mensal' },
      en: { name: 'Declaração periódica de IVA', description: 'Monthly VAT return' },
    },
  },
  {
    code: 'VAT_QUARTERLY_RETURN',
    authority: 'TAX',
    periodicity: 'QUARTERLY',
    legalRef: 'CIVA art. 41.º',
    appliesWhen: { all: [{ field: 'hasOpenActivity', op: 'eq', value: true }, { field: 'vatRegime', op: 'eq', value: 'QUARTERLY' }] },
    deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 20, monthsAfter: 2 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Declaração periódica de IVA', description: 'Regime trimestral' },
      en: { name: 'Declaração periódica de IVA', description: 'Quarterly VAT return' },
    },
  },
  {
    code: 'VAT_PAYMENT_MONTHLY',
    authority: 'TAX',
    periodicity: 'MONTHLY',
    legalRef: 'CIVA art. 27.º',
    appliesWhen: { all: [{ field: 'hasOpenActivity', op: 'eq', value: true }, { field: 'vatRegime', op: 'eq', value: 'MONTHLY' }] },
    deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 25, monthsAfter: 2 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Pagamento de IVA', description: 'Regime mensal' },
      en: { name: 'Pagamento de IVA', description: 'Monthly VAT payment' },
    },
  },
  {
    code: 'VAT_PAYMENT_QUARTERLY',
    authority: 'TAX',
    periodicity: 'QUARTERLY',
    legalRef: 'CIVA art. 27.º',
    appliesWhen: { all: [{ field: 'hasOpenActivity', op: 'eq', value: true }, { field: 'vatRegime', op: 'eq', value: 'QUARTERLY' }] },
    deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 25, monthsAfter: 2 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Pagamento de IVA', description: 'Regime trimestral' },
      en: { name: 'Pagamento de IVA', description: 'Quarterly VAT payment' },
    },
  },
  {
    code: 'EFATURA_INVOICE_REPORTING',
    authority: 'TAX',
    periodicity: 'MONTHLY',
    legalRef: 'Decreto-Lei n.º 198/2012',
    appliesWhen: { all: [{ field: 'hasOpenActivity', op: 'eq', value: true }] },
    deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 5, monthsAfter: 1 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Comunicação de faturas (e-Fatura)', description: 'Comunicação mensal à AT' },
      en: { name: 'Comunicação de faturas (e-Fatura)', description: 'Monthly invoice reporting to the tax authority' },
    },
  },
  {
    code: 'DMR_AT',
    authority: 'TAX',
    periodicity: 'MONTHLY',
    legalRef: 'CIRS art. 119.º',
    // Owner review: confirm this is genuinely distinct from SS_REMUNERATION_DECLARATION
    // (social-security.ts) — the master table lists them as two separate codes.
    appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'COMPANY' }] },
    deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 10, monthsAfter: 1 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Declaração Mensal de Remunerações (AT)', description: 'Retenções na fonte sobre rendimentos do trabalho' },
      en: { name: 'Declaração Mensal de Remunerações (AT)', description: 'Monthly withholding declaration to the tax authority' },
    },
  },
  {
    code: 'WITHHOLDING_TAX_PAYMENT',
    authority: 'TAX',
    periodicity: 'MONTHLY',
    legalRef: 'CIRS art. 98.º',
    // Owner review: master table's "applies to" column says "company"; this
    // conditions on hasWithholding instead, since that field exists
    // specifically to drive this rule and can also apply to an individual
    // with employees.
    appliesWhen: { all: [{ field: 'hasWithholding', op: 'eq', value: true }] },
    deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 20, monthsAfter: 1 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Pagamento de retenções na fonte', description: 'Entrega mensal ao Estado' },
      en: { name: 'Pagamento de retenções na fonte', description: 'Monthly withholding tax payment' },
    },
  },
  {
    code: 'MODEL_22_CIT_RETURN',
    authority: 'TAX',
    periodicity: 'ANNUAL',
    legalRef: 'CIRC art. 120.º',
    appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'COMPANY' }] },
    deadline: { kind: 'fixedDate', month: 5, day: 31, yearsAfter: 1 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Modelo 22', description: 'Declaração anual de IRC' },
      en: { name: 'Modelo 22', description: 'Annual corporate income tax return' },
    },
  },
  {
    code: 'IES_ANNUAL_FILING',
    authority: 'TAX',
    periodicity: 'ANNUAL',
    legalRef: 'Decreto-Lei n.º 8/2007',
    appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'COMPANY' }] },
    deadline: { kind: 'fixedDate', month: 7, day: 15, yearsAfter: 1 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'IES', description: 'Informação Empresarial Simplificada' },
      en: { name: 'IES', description: 'Simplified corporate information return' },
    },
  },
  {
    code: 'CIT_PAYMENT_ON_ACCOUNT_1',
    authority: 'TAX',
    periodicity: 'ANNUAL',
    legalRef: 'CIRC art. 104.º',
    // Owner review: exact day not given in the master spec's table
    // ("July, September, 15 December") — encoded as the last day of July.
    appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'COMPANY' }] },
    deadline: { kind: 'fixedDate', month: 7, day: 31, yearsAfter: 0 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Pagamento por conta de IRC (1.º)', description: 'Primeira prestação' },
      en: { name: 'Pagamento por conta de IRC (1.º)', description: 'First CIT payment on account' },
    },
  },
  {
    code: 'CIT_PAYMENT_ON_ACCOUNT_2',
    authority: 'TAX',
    periodicity: 'ANNUAL',
    legalRef: 'CIRC art. 104.º',
    // Owner review: exact day not given — encoded as the last day of September.
    appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'COMPANY' }] },
    deadline: { kind: 'fixedDate', month: 9, day: 30, yearsAfter: 0 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Pagamento por conta de IRC (2.º)', description: 'Segunda prestação' },
      en: { name: 'Pagamento por conta de IRC (2.º)', description: 'Second CIT payment on account' },
    },
  },
  {
    code: 'CIT_PAYMENT_ON_ACCOUNT_3',
    authority: 'TAX',
    periodicity: 'ANNUAL',
    legalRef: 'CIRC art. 104.º',
    appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'COMPANY' }] },
    deadline: { kind: 'fixedDate', month: 12, day: 15, yearsAfter: 0 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Pagamento por conta de IRC (3.º)', description: 'Terceira prestação (pagamento especial)' },
      en: { name: 'Pagamento por conta de IRC (3.º)', description: 'Third CIT payment on account' },
    },
  },
  {
    code: 'MODEL_10_INCOME_WITHHOLDING',
    authority: 'TAX',
    periodicity: 'ANNUAL',
    legalRef: 'CIRS art. 119.º',
    // Owner review: same hasWithholding reasoning as WITHHOLDING_TAX_PAYMENT above.
    appliesWhen: { all: [{ field: 'hasWithholding', op: 'eq', value: true }] },
    deadline: { kind: 'fixedDate', month: 1, day: 31, yearsAfter: 1 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Modelo 10', description: 'Declaração anual de rendimentos e retenções' },
      en: { name: 'Modelo 10', description: 'Annual income and withholding return' },
    },
  },
  {
    code: 'MODEL_30_NON_RESIDENT_PAYMENTS',
    authority: 'TAX',
    periodicity: 'MONTHLY',
    legalRef: 'CIRC art. 119.º',
    appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'COMPANY' }] },
    deadline: { kind: 'lastDayOfMonthAfterPeriodEnd', monthsAfter: 2 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Modelo 30', description: 'Rendimentos pagos ou devidos a não residentes' },
      en: { name: 'Modelo 30', description: 'Payments made to non-residents' },
    },
  },
  {
    code: 'INVENTORY_REPORTING',
    authority: 'TAX',
    periodicity: 'ANNUAL',
    legalRef: 'CIVA art. 29.º',
    appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'COMPANY' }] },
    deadline: { kind: 'fixedDate', month: 1, day: 31, yearsAfter: 1 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Comunicação de inventários', description: 'Inventário valorizado reportado à AT' },
      en: { name: 'Comunicação de inventários', description: 'Year-end inventory reporting' },
    },
  },
]
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/domain test -- catalog/tax`
Expected: PASS, all 16 cases green.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/domain typecheck && pnpm --filter @ledger-hq/domain lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/obligations/catalog/tax.ts packages/domain/src/obligations/catalog/tax.test.ts
git commit -m "feat(domain): add the tax-authority fiscal catalog (15 rules)"
```

---

### Task 6: Fiscal catalog — social security, individual rules, and the aggregated index

**Files:**
- Create: `packages/domain/src/obligations/catalog/social-security.ts`
- Create: `packages/domain/src/obligations/catalog/social-security.test.ts`
- Create: `packages/domain/src/obligations/catalog/individual.ts`
- Create: `packages/domain/src/obligations/catalog/individual.test.ts`
- Create: `packages/domain/src/obligations/catalog/index.ts`
- Create: `packages/domain/src/obligations/catalog/index.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `CatalogEntry` (Task 3); `resolveDueDate` (Task 3); `TAX_CATALOG` (Task 5).
- Produces (consumed by Task 9's generator, and by `apps/web`):
  - `SOCIAL_SECURITY_CATALOG: CatalogEntry[]` (2 entries)
  - `INDIVIDUAL_CATALOG: CatalogEntry[]` (1 entry)
  - `FISCAL_CATALOG: CatalogEntry[]` — all 18 entries, exported from `packages/domain`'s public surface via `index.ts`.

- [ ] **Step 1: Write the social-security catalog tests**

`packages/domain/src/obligations/catalog/social-security.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveDueDate } from '../resolver'
import { SOCIAL_SECURITY_CATALOG } from './social-security'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

function findEntry(code: string) {
  const entry = SOCIAL_SECURITY_CATALOG.find((candidate) => candidate.code === code)
  if (!entry) throw new Error(`no catalog entry for ${code}`)
  return entry
}

describe('SOCIAL_SECURITY_CATALOG', () => {
  it('has 2 entries', () => {
    expect(SOCIAL_SECURITY_CATALOG).toHaveLength(2)
  })

  it('SS_REMUNERATION_DECLARATION: 10th of the following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('SS_REMUNERATION_DECLARATION'), period)).toEqual(utc(2026, 2, 10))
  })

  it('SS_CONTRIBUTION_PAYMENT: 20th of the following month', () => {
    const period = { start: utc(2026, 1, 1), end: utc(2026, 1, 31), label: '2026-01' }
    expect(resolveDueDate(findEntry('SS_CONTRIBUTION_PAYMENT'), period)).toEqual(utc(2026, 2, 20))
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/domain test -- catalog/social-security`
Expected: FAIL — `./social-security` does not exist.

- [ ] **Step 3: Implement the social-security catalog**

`packages/domain/src/obligations/catalog/social-security.ts`:

```ts
import type { CatalogEntry } from '../catalog-types'

const VALID_FROM = '2023-01-01'

export const SOCIAL_SECURITY_CATALOG: CatalogEntry[] = [
  {
    code: 'SS_REMUNERATION_DECLARATION',
    authority: 'SOCIAL_SECURITY',
    periodicity: 'MONTHLY',
    legalRef: 'Código Contributivo art. 41.º',
    appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'COMPANY' }] },
    deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 10, monthsAfter: 1 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Declaração de Remunerações (Segurança Social)', description: 'Remunerações do mês anterior' },
      en: { name: 'Declaração de Remunerações (Segurança Social)', description: 'Monthly wage declaration to Social Security' },
    },
  },
  {
    code: 'SS_CONTRIBUTION_PAYMENT',
    authority: 'SOCIAL_SECURITY',
    periodicity: 'MONTHLY',
    legalRef: 'Código Contributivo art. 43.º',
    appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'COMPANY' }] },
    deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 20, monthsAfter: 1 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Pagamento de contribuições', description: 'Contribuições para a Segurança Social' },
      en: { name: 'Pagamento de contribuições', description: 'Social Security contribution payment' },
    },
  },
]
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/domain test -- catalog/social-security`
Expected: PASS.

- [ ] **Step 5: Write the individual catalog test**

`packages/domain/src/obligations/catalog/individual.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveDueDate } from '../resolver'
import { INDIVIDUAL_CATALOG } from './individual'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

describe('INDIVIDUAL_CATALOG', () => {
  it('has 1 entry', () => {
    expect(INDIVIDUAL_CATALOG).toHaveLength(1)
  })

  it('MODEL_3_PIT_RETURN: due 30 June of the following year', () => {
    const entry = INDIVIDUAL_CATALOG[0]!
    const period = { start: utc(2025, 1, 1), end: utc(2025, 12, 31), label: '2025' }
    expect(resolveDueDate(entry, period)).toEqual(utc(2026, 6, 30))
  })

  it('applies only to individuals', () => {
    expect(INDIVIDUAL_CATALOG[0]!.appliesWhen).toEqual({ all: [{ field: 'kind', op: 'eq', value: 'INDIVIDUAL' }] })
  })
})
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/domain test -- catalog/individual`
Expected: FAIL — `./individual` does not exist.

- [ ] **Step 7: Implement the individual catalog**

`packages/domain/src/obligations/catalog/individual.ts`:

```ts
import type { CatalogEntry } from '../catalog-types'

export const INDIVIDUAL_CATALOG: CatalogEntry[] = [
  {
    code: 'MODEL_3_PIT_RETURN',
    authority: 'TAX',
    periodicity: 'ANNUAL',
    legalRef: 'CIRS art. 60.º',
    // The master spec's own filing window is "1 April to 30 June" — encoded
    // as its closing date, 30 June, the date lateness is measured against
    // (see this plan's "Decisions" section).
    appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'INDIVIDUAL' }] },
    deadline: { kind: 'fixedDate', month: 6, day: 30, yearsAfter: 1 },
    businessDayShift: 'NEXT',
    validFrom: '2023-01-01',
    validTo: null,
    i18n: {
      pt: { name: 'Modelo 3', description: 'Declaração anual de IRS' },
      en: { name: 'Modelo 3', description: 'Annual personal income tax return' },
    },
  },
]
```

- [ ] **Step 8: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/domain test -- catalog/individual`
Expected: PASS.

- [ ] **Step 9: Write the aggregated index test**

`packages/domain/src/obligations/catalog/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FISCAL_CATALOG } from './index'

describe('FISCAL_CATALOG', () => {
  it('aggregates all 18 entries with no duplicate codes', () => {
    expect(FISCAL_CATALOG).toHaveLength(18)
    expect(new Set(FISCAL_CATALOG.map((entry) => entry.code)).size).toBe(18)
  })

  it('every entry has validFrom, a legalRef, and both locales in i18n', () => {
    for (const entry of FISCAL_CATALOG) {
      expect(entry.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry.legalRef.length).toBeGreaterThan(0)
      expect(entry.i18n.pt.name.length).toBeGreaterThan(0)
      expect(entry.i18n.en.name.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 10: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/domain test -- catalog/index`
Expected: FAIL — `./index` does not exist yet (as a module distinct from the directory's implicit barrel — Node/TypeScript will not resolve `./index` from within the same directory without the file existing explicitly).

- [ ] **Step 11: Implement the aggregated index**

`packages/domain/src/obligations/catalog/index.ts`:

```ts
import type { CatalogEntry } from '../catalog-types'
import { TAX_CATALOG } from './tax'
import { SOCIAL_SECURITY_CATALOG } from './social-security'
import { INDIVIDUAL_CATALOG } from './individual'

export const FISCAL_CATALOG: CatalogEntry[] = [...TAX_CATALOG, ...SOCIAL_SECURITY_CATALOG, ...INDIVIDUAL_CATALOG]
```

- [ ] **Step 12: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/domain test -- catalog`
Expected: PASS — every catalog test file (tax, social-security, individual, index) green.

- [ ] **Step 13: Export the catalog and its types from the package's public surface**

Add to `packages/domain/src/index.ts` (after the existing `export * from './schemas/vault'` line):

```ts
export * from './obligations/catalog-types'
export * from './obligations/catalog/index'
export * from './obligations/resolver'
export * from './obligations/holidays'
export * from './obligations/group-by-urgency'
```

- [ ] **Step 14: Run the full domain test suite, typecheck, lint**

Run: `pnpm --filter @ledger-hq/domain test && pnpm --filter @ledger-hq/domain typecheck && pnpm --filter @ledger-hq/domain lint`
Expected: all green — this is the first time everything from Tasks 1-6 is exercised together through the package's actual public exports.

- [ ] **Step 15: Commit**

```bash
git add packages/domain/src/obligations/catalog/social-security.ts packages/domain/src/obligations/catalog/social-security.test.ts \
  packages/domain/src/obligations/catalog/individual.ts packages/domain/src/obligations/catalog/individual.test.ts \
  packages/domain/src/obligations/catalog/index.ts packages/domain/src/obligations/catalog/index.test.ts \
  packages/domain/src/index.ts
git commit -m "feat(domain): add the social-security and individual catalogs, and the aggregated index"
```

---

### Task 7: Generate `docs/fiscal-catalog.md`

**Files:**
- Modify: `packages/domain/package.json` (add a `generate:fiscal-catalog` script)
- Create: `packages/domain/scripts/generate-fiscal-catalog.mjs`
- Create: `docs/fiscal-catalog.md` (generated output, committed)

**Interfaces:**
- Consumes: `FISCAL_CATALOG` (Task 6), read from the package's **built** output (`dist/`), not its TypeScript source — plain Node has no TypeScript loader configured in this repo (confirmed: no `tsx`/`ts-node` dependency exists anywhere in the monorepo), so this script runs after `pnpm --filter @ledger-hq/domain build`, the same way `apps/web/scripts/check-locales.mjs` is a plain Node script reading built/static JSON rather than TypeScript source.
- Produces: nothing consumed by later tasks — `docs/fiscal-catalog.md` is documentation output for the owner's review (design doc section 3.1), not code.

- [ ] **Step 1: Add the generator script**

`packages/domain/scripts/generate-fiscal-catalog.mjs`:

```js
import { writeFileSync } from 'node:fs'
import { FISCAL_CATALOG } from '../dist/obligations/catalog/index.js'

function deadlineText(entry) {
  const { deadline } = entry
  if (deadline.kind === 'fixedDate') {
    return `${deadline.day}/${deadline.month}${deadline.yearsAfter > 0 ? ' (following year)' : ''}`
  }
  if (deadline.kind === 'lastDayOfMonthAfterPeriodEnd') {
    return `last day of the ${deadline.monthsAfter}-months-after month`
  }
  return `day ${deadline.day} of the ${deadline.monthsAfter}-months-after month`
}

function section(locale) {
  const rows = FISCAL_CATALOG.map(
    (entry) =>
      `| \`${entry.code}\` | ${entry.i18n[locale].name} | ${entry.i18n[locale].description} | ${entry.authority} | ${entry.periodicity} | ${deadlineText(entry)} | ${entry.legalRef} | ${entry.validFrom} | ${entry.validTo ?? '—'} |`,
  )

  return [
    `## ${locale === 'pt' ? 'Português' : 'English'}`,
    '',
    '| Code | Name | Description | Authority | Periodicity | Deadline | Legal reference | Valid from | Valid to |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

const content = [
  '# Fiscal obligation catalog',
  '',
  '**Generated from `packages/domain/src/obligations/catalog/`. Do not edit by hand — edit the catalog source and re-run `pnpm --filter @ledger-hq/domain generate:fiscal-catalog`.**',
  '',
  section('pt'),
  '',
  section('en'),
  '',
].join('\n')

writeFileSync(new URL('../../../docs/fiscal-catalog.md', import.meta.url), content)
console.log(`Wrote docs/fiscal-catalog.md with ${FISCAL_CATALOG.length} entries.`)
```

- [ ] **Step 2: Add the package script**

Add to `packages/domain/package.json`'s `"scripts"` object (after `"test"`):

```json
    "generate:fiscal-catalog": "pnpm build && node scripts/generate-fiscal-catalog.mjs"
```

- [ ] **Step 3: Run it**

Run: `pnpm --filter @ledger-hq/domain generate:fiscal-catalog`
Expected: builds the package, then prints `Wrote docs/fiscal-catalog.md with 18 entries.`

- [ ] **Step 4: Review the generated file**

Open `docs/fiscal-catalog.md` and confirm it lists all 18 entries with readable deadline text, in both Portuguese and English sections. This file is exactly what design doc section 3.1's owner-review step reads — flag anything here as a candidate name/description fix (not a plan step; a follow-up edit to the relevant catalog file if the owner asks for one during review).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/package.json packages/domain/scripts/generate-fiscal-catalog.mjs docs/fiscal-catalog.md
git commit -m "docs: generate the fiscal obligation catalog reference"
```

---

### Task 8: Database schema, migration, and reset-order wiring

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_obligations/migration.sql` (generated)
- Modify: `apps/api/test/database.ts`
- Modify: `apps/api/test/schema-constraints.integration.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks except enum names, which must match `packages/domain/src/enums.ts`'s `AUTHORITY_VALUES`/`PERIODICITY_VALUES`/`OBLIGATION_STATUS_VALUES`/`DEFINITION_SOURCE_VALUES` exactly (Task 1).
- Produces (consumed by Task 9):
  - Prisma models `ObligationDefinition`, `ObligationInstance`.
  - A `obligations ObligationInstance[]` relation on the existing `Client` model.

A local Postgres must be reachable for this task — `docker compose up -d`
from the repo root, and `apps/api/.env`'s `DATABASE_URL` must point at it
(both already true if Phase 0/1 were set up on this machine; if
`pnpm exec prisma migrate dev` in Step 2 below fails to connect, that is an
environment problem to fix before continuing, not a reason to change this
task's schema).

- [ ] **Step 1: Extend the schema**

Add to `apps/api/prisma/schema.prisma`, after the existing `AuthKind` enum:

```prisma
enum Authority {
  TAX
  SOCIAL_SECURITY
  REGISTRY
  OTHER
}

enum Periodicity {
  MONTHLY
  QUARTERLY
  ANNUAL
  ONE_OFF
}

enum ObligationStatus {
  PENDING
  IN_PROGRESS
  DONE
  WAIVED
}

enum DefinitionSource {
  CATALOG
  CUSTOM
}
```

Add an `obligations` relation to the existing `Client` model (alongside `credentials`):

```prisma
  obligations ObligationInstance[]
```

Add two new models, after `CredentialVersion`:

```prisma
model ObligationDefinition {
  code        String           @id
  name        String
  authority   Authority
  periodicity Periodicity
  source      DefinitionSource
  legalRef    String?
  active      Boolean          @default(true)

  instances ObligationInstance[]
}

model ObligationInstance {
  id                String           @id @db.Uuid
  clientId          String           @db.Uuid
  definitionCode    String
  periodStart       DateTime         @db.Date
  periodEnd         DateTime         @db.Date
  periodLabel       String
  dueDate           DateTime         @db.Date
  dueDateOverridden Boolean          @default(false)
  status            ObligationStatus @default(PENDING)
  completedAt       DateTime?        @db.Timestamptz(3)
  reference         String?
  amountCents       Int?
  notes             String?
  createdAt         DateTime         @default(now()) @db.Timestamptz(3)
  updatedAt         DateTime         @updatedAt @db.Timestamptz(3)

  client     Client               @relation(fields: [clientId], references: [id], onDelete: Cascade)
  definition ObligationDefinition @relation(fields: [definitionCode], references: [code])

  @@unique([clientId, definitionCode, periodStart])
  @@index([clientId])
  @@index([status, dueDate])
}
```

`ObligationInstance.client` references `Client.id` alone, not the composite
`[id, kind]` `Employment` uses — the same reasoning `Credential` already
established in Phase 1: an obligation applies identically regardless of
which of the two client kinds it's attached to (the catalog's own
`appliesWhen.kind` condition is what restricts a rule to one kind, not the
foreign key), so there is no kind to pin.

- [ ] **Step 2: Generate and apply the migration**

```bash
cd apps/api
pnpm exec prisma migrate dev --name obligations
```

Expected: a new `prisma/migrations/<timestamp>_obligations/` directory with a
`migration.sql` creating the four enums, the two tables, and the `Client`
relation's foreign key; the migration applies cleanly and the Prisma client
regenerates. Confirm the client actually regenerated by checking that
`src/generated/prisma/models/ObligationDefinition.ts` and
`ObligationInstance.ts` now exist — Phase 1's Task 4 discovered that
`migrate dev` does not always trigger client regeneration reliably in this
setup; if those files are missing, run `pnpm exec prisma generate`
explicitly before continuing.

- [ ] **Step 3: Extend the integration test harness's reset order**

`ObligationInstance` is a child of both `Client` and `ObligationDefinition`;
it must be deleted before either parent, and `ObligationDefinition` itself
has no parent in this deletion chain (nothing else references it), so it can
be deleted any time before the harness finishes — placed here right after
its own instances for locality. Modify `apps/api/test/database.ts`:

```ts
export async function resetDatabase(): Promise<void> {
  const prisma = getTestPrisma()

  await prisma.systemHealth.deleteMany()
  await prisma.obligationInstance.deleteMany()
  await prisma.obligationDefinition.deleteMany()
  await prisma.credentialVersion.deleteMany()
  await prisma.credential.deleteMany()
  await prisma.platform.deleteMany()
  await prisma.employment.deleteMany()
  await prisma.fiscalProfile.deleteMany()
  await prisma.auditEvent.deleteMany()
  await prisma.client.deleteMany()
  await prisma.session.deleteMany()
  await prisma.user.deleteMany()
}
```

- [ ] **Step 4: Write a constraint test for the instance uniqueness triple**

Add to `apps/api/test/schema-constraints.integration.test.ts` (mirroring the
file's existing style — writing directly through Prisma, bypassing any
service layer, to prove the database itself rejects the violation):

```ts
describe('obligation constraints', () => {
  it('rejects two instances with the same client, definition and period start', async () => {
    const prisma = getTestPrisma()
    const client = await prisma.client.create({
      data: { id: uuidv7(), kind: 'COMPANY', name: 'X', taxId: '500000002', accounting: 'ORGANIZED', legalForm: 'LDA' },
    })
    const definition = await prisma.obligationDefinition.create({
      data: { code: 'TEST_OBLIGATION', name: 'Test', authority: 'TAX', periodicity: 'MONTHLY', source: 'CATALOG' },
    })
    const shared = {
      clientId: client.id,
      definitionCode: definition.code,
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-01-31T00:00:00Z'),
      periodLabel: '2026-01',
      dueDate: new Date('2026-03-20T00:00:00Z'),
    }

    await prisma.obligationInstance.create({ data: { id: uuidv7(), ...shared } })

    await expect(prisma.obligationInstance.create({ data: { id: uuidv7(), ...shared } })).rejects.toThrow()
  })
})
```

(Confirm the file already imports `uuidv7` and `getTestPrisma` — both are
already imported for the existing `client kind constraints`/`employment
constraints` blocks from Phase 0.)

- [ ] **Step 5: Run the constraint test**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: PASS, including this new case.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/database.ts \
  apps/api/test/schema-constraints.integration.test.ts
git commit -m "feat(api): add the obligations schema — definitions and instances"
```

---

### Task 9: Domain request/response schemas

**Files:**
- Create: `packages/domain/src/schemas/obligation.ts`
- Create: `packages/domain/src/schemas/obligation.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `isoDateSchema`, `uuidSchema` (`./common`, Phase 0); `OBLIGATION_STATUS_VALUES`, `PERIODICITY_VALUES` (Task 1).
- Produces (consumed by Tasks 10-12's API layer, and by `apps/web`):
  - `listObligationsQuerySchema`, `ListObligationsQuery`
  - `generateObligationsQuerySchema`, `GenerateObligationsQuery`
  - `generateObligationsBodySchema`, `GenerateObligationsInput`
  - `patchObligationSchema`, `PatchObligationInput`
  - `createAdHocObligationSchema`, `CreateAdHocObligationInput`

- [ ] **Step 1: Write the schema tests**

`packages/domain/src/schemas/obligation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  createAdHocObligationSchema,
  generateObligationsBodySchema,
  listObligationsQuerySchema,
  patchObligationSchema,
} from './obligation'

const uuid = '01927e6a-0000-7000-8000-000000000000'

describe('listObligationsQuerySchema', () => {
  it('accepts no filters', () => {
    expect(listObligationsQuerySchema.safeParse({}).success).toBe(true)
  })

  it('accepts a clientId and a comma-separated status filter', () => {
    const result = listObligationsQuerySchema.safeParse({ clientId: uuid, status: 'PENDING,IN_PROGRESS' })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown field', () => {
    expect(listObligationsQuerySchema.safeParse({ clientId: uuid, bogus: '1' }).success).toBe(false)
  })
})

describe('generateObligationsBodySchema', () => {
  it('accepts an empty body — asOf and clientId both default at the service layer', () => {
    expect(generateObligationsBodySchema.safeParse({}).success).toBe(true)
  })

  it('accepts an explicit asOf and clientId', () => {
    expect(generateObligationsBodySchema.safeParse({ asOf: '2026-03-18', clientId: uuid }).success).toBe(true)
  })

  it('rejects a non-ISO asOf', () => {
    expect(generateObligationsBodySchema.safeParse({ asOf: '18/03/2026' }).success).toBe(false)
  })
})

describe('patchObligationSchema', () => {
  it('accepts a due-date override alone', () => {
    expect(patchObligationSchema.safeParse({ dueDate: '2026-04-01' }).success).toBe(true)
  })

  it('accepts marking DONE with no notes', () => {
    expect(patchObligationSchema.safeParse({ status: 'DONE' }).success).toBe(true)
  })

  it('rejects marking WAIVED with no notes', () => {
    const result = patchObligationSchema.safeParse({ status: 'WAIVED' })
    expect(result.success).toBe(false)
  })

  it('rejects marking WAIVED with blank notes', () => {
    expect(patchObligationSchema.safeParse({ status: 'WAIVED', notes: '   ' }).success).toBe(false)
  })

  it('accepts marking WAIVED with a real reason', () => {
    expect(patchObligationSchema.safeParse({ status: 'WAIVED', notes: 'Client ceased activity' }).success).toBe(true)
  })
})

describe('createAdHocObligationSchema', () => {
  it('accepts a well-formed ad-hoc obligation', () => {
    const result = createAdHocObligationSchema.safeParse({
      clientId: uuid,
      code: 'BACKUP_RESTORE_DRILL',
      name: 'Backup restore drill',
      periodicity: 'ONE_OFF',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-01',
      periodLabel: '2026',
      dueDate: '2026-03-31',
    })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/domain test -- schemas/obligation`
Expected: FAIL — `./obligation` does not exist.

- [ ] **Step 3: Implement the schemas**

`packages/domain/src/schemas/obligation.ts`:

```ts
import { z } from 'zod'
import { OBLIGATION_STATUS_VALUES, PERIODICITY_VALUES } from '../enums'
import { isoDateSchema, uuidSchema } from './common'

export const listObligationsQuerySchema = z
  .object({
    clientId: uuidSchema.optional(),
    // Comma-separated ObligationStatus values (e.g. "PENDING,IN_PROGRESS");
    // parsed and validated member-by-member at the service layer rather
    // than here, since Zod has no built-in "comma-separated enum" primitive
    // and a bespoke regex would just re-derive OBLIGATION_STATUS_VALUES by hand.
    status: z.string().optional(),
  })
  .strict()

export type ListObligationsQuery = z.infer<typeof listObligationsQuerySchema>

export const generateObligationsQuerySchema = z
  .object({ dryRun: z.enum(['true', 'false']).optional() })
  .strict()

export type GenerateObligationsQuery = z.infer<typeof generateObligationsQuerySchema>

export const generateObligationsBodySchema = z
  .object({
    asOf: isoDateSchema.optional(),
    clientId: uuidSchema.optional(),
  })
  .strict()

export type GenerateObligationsInput = z.infer<typeof generateObligationsBodySchema>

export const patchObligationSchema = z
  .object({
    dueDate: isoDateSchema.optional(),
    status: z.enum(OBLIGATION_STATUS_VALUES).optional(),
    reference: z.string().trim().max(200).optional(),
    amountCents: z.number().int().nonnegative().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .refine((value) => value.status !== 'WAIVED' || (value.notes?.trim().length ?? 0) > 0, {
    message: 'obligations.waived_reason_required',
    path: ['notes'],
  })

export type PatchObligationInput = z.infer<typeof patchObligationSchema>

export const createAdHocObligationSchema = z
  .object({
    clientId: uuidSchema,
    code: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    periodicity: z.enum(PERIODICITY_VALUES),
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    periodLabel: z.string().trim().min(1).max(50),
    dueDate: isoDateSchema,
  })
  .strict()

export type CreateAdHocObligationInput = z.infer<typeof createAdHocObligationSchema>
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/domain test -- schemas/obligation`
Expected: PASS.

- [ ] **Step 5: Export the new schemas**

Add to `packages/domain/src/index.ts`:

```ts
export * from './schemas/obligation'
```

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/domain typecheck && pnpm --filter @ledger-hq/domain lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/schemas/obligation.ts packages/domain/src/schemas/obligation.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): add obligation request schemas"
```

---

### Task 10: The generator — `ObligationsService.generate` and `syncCatalogDefinitions`

**Files:**
- Create: `apps/api/src/obligations/obligations.service.ts`
- Create: `apps/api/src/obligations/obligations.service.test.ts`

**Interfaces:**
- Consumes: `FISCAL_CATALOG`, `appliesTo`, `generatePeriods`, `resolveDueDate`, `ObligationSubject`, `CatalogEntry` (`@ledger-hq/domain`, Tasks 3-6); `ClientsService.findOne` (Phase 0); `PrismaService` (Phase 0).
- Produces (consumed by Task 11's CRUD methods on the same service, Task 12's controller/cron, and this task's own tests):
  - `ObligationsService.syncCatalogDefinitions(): Promise<void>`
  - `ObligationsService.generate(input: { asOf: Date; clientId?: string }, dryRun: boolean): Promise<GenerateResult>`
  - `GenerateResult = { toCreate: Array<{ clientId: string; definitionCode: string; periodLabel: string; dueDate: string }>; toRetract: Array<{ clientId: string; definitionCode: string; periodLabel: string }> }`

This is the task that turns the four generator invariants from this plan's
Global Constraints into running code. Each is a named test below.

- [ ] **Step 1: Write the generator tests**

`apps/api/src/obligations/obligations.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../common/prisma.service.js'
import type { ClientsService } from '../clients/clients.service.js'
import { ObligationsService } from './obligations.service.js'

function fakePrisma(overrides: Record<string, unknown> = {}): PrismaService {
  return {
    obligationDefinition: { upsert: vi.fn().mockResolvedValue({}) },
    client: { findMany: vi.fn().mockResolvedValue([]) },
    fiscalProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    obligationInstance: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    ...overrides,
  } as unknown as PrismaService
}

function fakeClientsService(client: unknown): ClientsService {
  return { findOne: vi.fn().mockResolvedValue(client) } as unknown as ClientsService
}

const COMPANY_PROFILE = {
  hasOpenActivity: true,
  vatRegime: 'MONTHLY',
  incomeTax: 'CIT',
  hasEmployees: false,
  hasWithholding: false,
  isVatCashBasis: false,
}

describe('ObligationsService#syncCatalogDefinitions', () => {
  it('upserts one definition per catalog entry', async () => {
    const prisma = fakePrisma()
    const service = new ObligationsService(prisma, fakeClientsService(null))

    await service.syncCatalogDefinitions()

    expect(vi.mocked(prisma.obligationDefinition.upsert)).toHaveBeenCalledTimes(18)
  })
})

describe('ObligationsService#generate', () => {
  const client = { id: 'c1', kind: 'COMPANY', archivedAt: null }

  it('generates nothing for a client with no fiscal profile', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      fiscalProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    })
    const service = new ObligationsService(prisma, fakeClientsService(client))

    const result = await service.generate({ asOf: new Date('2026-03-18T00:00:00Z') }, true)

    expect(result.toCreate).toEqual([])
  })

  it('is idempotent: a second dry run against the same already-created instances proposes nothing new', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      fiscalProfile: { findUnique: vi.fn().mockResolvedValue(COMPANY_PROFILE) },
    })
    const service = new ObligationsService(prisma, fakeClientsService(client))
    const asOf = new Date('2026-03-18T00:00:00Z')

    const first = await service.generate({ asOf, clientId: 'c1' }, true)
    expect(first.toCreate.length).toBeGreaterThan(0)

    // Simulate the first run having been applied: mock `findMany` to report
    // exactly the instances the first dry run proposed, so the second call
    // sees them as already existing, keyed by `periodStart` the same way
    // the service itself keys them (every label this catalog produces is
    // "YYYY-MM", "YYYY-QN", or "YYYY").
    function periodStartFor(label: string): Date {
      if (/^\d{4}-\d{2}$/.test(label)) return new Date(`${label}-01T00:00:00Z`)
      if (/^\d{4}-Q\d$/.test(label)) {
        const [year, q] = label.split('-Q')
        const month = (Number(q) - 1) * 3 + 1
        return new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00Z`)
      }
      return new Date(`${label}-01-01T00:00:00Z`)
    }

    vi.mocked(prisma.obligationInstance.findMany).mockResolvedValue(
      first.toCreate.map((item) => ({
        id: 'x',
        clientId: 'c1',
        definitionCode: item.definitionCode,
        periodStart: periodStartFor(item.periodLabel),
        status: 'PENDING',
      })) as never,
    )

    const second = await service.generate({ asOf, clientId: 'c1' }, true)
    expect(second.toCreate).toEqual([])
  })

  it('never proposes an instance whose period ends more than 3 months before asOf', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      fiscalProfile: { findUnique: vi.fn().mockResolvedValue(COMPANY_PROFILE) },
    })
    const service = new ObligationsService(prisma, fakeClientsService(client))

    const result = await service.generate({ asOf: new Date('2026-03-18T00:00:00Z'), clientId: 'c1' }, true)

    for (const item of result.toCreate) {
      // Every MONTHLY/QUARTERLY period label in the result must be no
      // earlier than December 2025 (3 months before March 2026).
      expect(item.periodLabel >= '2025-12').toBe(true)
    }
  })

  it('retracts a PENDING instance whose rule no longer applies, once the profile changes', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      fiscalProfile: {
        // hasEmployees flips to false — a payroll-only rule would stop
        // applying. This plan's initial catalog has no employee-gated rule,
        // so this test uses vatRegime flipping to NOT_APPLICABLE instead,
        // which retracts every VAT-conditioned instance.
        findUnique: vi.fn().mockResolvedValue({ ...COMPANY_PROFILE, hasOpenActivity: false, vatRegime: 'NOT_APPLICABLE' }),
      },
      obligationInstance: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'existing-1', clientId: 'c1', definitionCode: 'VAT_MONTHLY_RETURN', periodStart: new Date('2026-01-01T00:00:00Z'), status: 'PENDING' },
        ]),
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    })
    const service = new ObligationsService(prisma, fakeClientsService(client))

    const result = await service.generate({ asOf: new Date('2026-03-18T00:00:00Z'), clientId: 'c1' }, true)

    expect(result.toRetract).toContainEqual({ clientId: 'c1', definitionCode: 'VAT_MONTHLY_RETURN', periodLabel: expect.any(String) })
  })

  it('never touches an instance whose status is not PENDING, even when its rule no longer applies', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      fiscalProfile: {
        findUnique: vi.fn().mockResolvedValue({ ...COMPANY_PROFILE, hasOpenActivity: false, vatRegime: 'NOT_APPLICABLE' }),
      },
      obligationInstance: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'done-1', clientId: 'c1', definitionCode: 'VAT_MONTHLY_RETURN', periodStart: new Date('2026-01-01T00:00:00Z'), status: 'DONE' },
        ]),
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    })
    const service = new ObligationsService(prisma, fakeClientsService(client))

    const result = await service.generate({ asOf: new Date('2026-03-18T00:00:00Z'), clientId: 'c1' }, true)

    expect(result.toRetract).toEqual([])
  })

  it('dry run never calls create or deleteMany', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      fiscalProfile: { findUnique: vi.fn().mockResolvedValue(COMPANY_PROFILE) },
    })
    const service = new ObligationsService(prisma, fakeClientsService(client))

    await service.generate({ asOf: new Date('2026-03-18T00:00:00Z'), clientId: 'c1' }, true)

    expect(prisma.obligationInstance.create).not.toHaveBeenCalled()
    expect(prisma.obligationInstance.deleteMany).not.toHaveBeenCalled()
  })

  it('apply (dryRun=false) calls create for every proposed instance', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      fiscalProfile: { findUnique: vi.fn().mockResolvedValue(COMPANY_PROFILE) },
    })
    const service = new ObligationsService(prisma, fakeClientsService(client))

    const dryRunResult = await service.generate({ asOf: new Date('2026-03-18T00:00:00Z'), clientId: 'c1' }, true)
    await service.generate({ asOf: new Date('2026-03-18T00:00:00Z'), clientId: 'c1' }, false)

    expect(vi.mocked(prisma.obligationInstance.create)).toHaveBeenCalledTimes(dryRunResult.toCreate.length)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/api test -- obligations.service`
Expected: FAIL — `./obligations.service` does not exist.

- [ ] **Step 3: Implement the service**

`apps/api/src/obligations/obligations.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
import { uuidv7 } from 'uuidv7'
import {
  FISCAL_CATALOG,
  appliesTo,
  generatePeriods,
  resolveDueDate,
} from '@ledger-hq/domain'
import type { CatalogEntry, ClientKind, ObligationSubject } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ClientsService } from '../clients/clients.service.js'
import type { FiscalProfile } from '../generated/prisma/client.js'

const HORIZON_MONTHS = 12

export type GenerateResult = {
  toCreate: Array<{ clientId: string; definitionCode: string; periodLabel: string; dueDate: string }>
  toRetract: Array<{ clientId: string; definitionCode: string; periodLabel: string }>
}

@Injectable()
export class ObligationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
  ) {}

  /** Upserts one `ObligationDefinition` row per catalog entry — the table is a mirror of the catalog, never edited by hand for CATALOG-sourced codes. */
  async syncCatalogDefinitions(): Promise<void> {
    for (const entry of FISCAL_CATALOG) {
      await this.prisma.obligationDefinition.upsert({
        where: { code: entry.code },
        create: {
          code: entry.code,
          name: entry.i18n.pt.name,
          authority: entry.authority,
          periodicity: entry.periodicity,
          source: 'CATALOG',
          legalRef: entry.legalRef,
          active: true,
        },
        update: {
          name: entry.i18n.pt.name,
          authority: entry.authority,
          periodicity: entry.periodicity,
          legalRef: entry.legalRef,
          active: true,
        },
      })
    }
  }

  /**
   * The generator. `dryRun: true` computes and returns what would change
   * without writing anything; `dryRun: false` applies it. `input.clientId`
   * scopes the sweep to one client (used by the per-client preview after a
   * fiscal-profile save); omitted, it sweeps every active client (the daily
   * cron).
   */
  async generate(input: { asOf: Date; clientId?: string }, dryRun: boolean): Promise<GenerateResult> {
    await this.syncCatalogDefinitions()

    const clients = input.clientId
      ? [await this.clients.findOne(input.clientId)]
      : await this.prisma.client.findMany({ where: { archivedAt: null } })

    const horizonEnd = addMonths(input.asOf, HORIZON_MONTHS)
    const floor = addMonths(input.asOf, -3)

    const toCreate: Array<{ clientId: string; definitionCode: string; period: { start: Date; end: Date; label: string }; dueDate: Date }> = []
    const toRetract: Array<{ id: string; clientId: string; definitionCode: string; periodLabel: string }> = []

    for (const client of clients) {
      const profile = await this.prisma.fiscalProfile.findUnique({ where: { clientId: client.id } })
      if (!profile) continue

      const subject = toSubject(client.kind, profile)
      const existingInstances = await this.prisma.obligationInstance.findMany({ where: { clientId: client.id } })

      for (const entry of FISCAL_CATALOG) {
        const applies = appliesTo(entry, subject) && withinValidity(entry, input.asOf)
        const periods = applies ? generatePeriods(entry.periodicity, floor, horizonEnd) : []
        const periodKeys = new Set(periods.map((period) => isoKey(period.start)))

        const existingForCode = existingInstances.filter((instance) => instance.definitionCode === entry.code)
        const existingKeys = new Set(existingForCode.map((instance) => isoKey(instance.periodStart)))

        for (const period of periods) {
          if (!existingKeys.has(isoKey(period.start))) {
            toCreate.push({ clientId: client.id, definitionCode: entry.code, period, dueDate: resolveDueDate(entry, period) })
          }
        }

        for (const instance of existingForCode) {
          if (instance.status === 'PENDING' && !periodKeys.has(isoKey(instance.periodStart))) {
            toRetract.push({
              id: instance.id,
              clientId: client.id,
              definitionCode: entry.code,
              periodLabel: instance.periodLabel,
            })
          }
        }
      }
    }

    if (!dryRun) {
      for (const item of toCreate) {
        await this.prisma.obligationInstance.create({
          data: {
            id: uuidv7(),
            clientId: item.clientId,
            definitionCode: item.definitionCode,
            periodStart: item.period.start,
            periodEnd: item.period.end,
            periodLabel: item.period.label,
            dueDate: item.dueDate,
          },
        })
      }

      if (toRetract.length > 0) {
        await this.prisma.obligationInstance.deleteMany({ where: { id: { in: toRetract.map((item) => item.id) } } })
      }
    }

    return {
      toCreate: toCreate.map((item) => ({
        clientId: item.clientId,
        definitionCode: item.definitionCode,
        periodLabel: item.period.label,
        dueDate: isoKey(item.dueDate),
      })),
      toRetract: toRetract.map((item) => ({
        clientId: item.clientId,
        definitionCode: item.definitionCode,
        periodLabel: item.periodLabel,
      })),
    }
  }
}

function toSubject(kind: ClientKind, profile: FiscalProfile): ObligationSubject {
  return {
    kind,
    hasOpenActivity: profile.hasOpenActivity,
    vatRegime: profile.vatRegime,
    incomeTax: profile.incomeTax,
    hasEmployees: profile.hasEmployees,
    hasWithholding: profile.hasWithholding,
    isVatCashBasis: profile.isVatCashBasis,
  }
}

function isoKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()))
}

function withinValidity(entry: CatalogEntry, asOf: Date): boolean {
  const validFrom = new Date(`${entry.validFrom}T00:00:00Z`)
  if (asOf < validFrom) return false
  if (entry.validTo === null) return true
  return asOf <= new Date(`${entry.validTo}T00:00:00Z`)
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/api test -- obligations.service`
Expected: PASS, all cases green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @ledger-hq/api typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/obligations/obligations.service.ts apps/api/src/obligations/obligations.service.test.ts
git commit -m "feat(api): add the obligation generator (dry-run and apply)"
```

---

### Task 11: Listing, manual adjustment, ad-hoc creation, and the controller

**Files:**
- Modify: `apps/api/src/obligations/obligations.service.ts`
- Create: `apps/api/src/obligations/obligations.controller.ts`
- Test: `apps/api/test/obligations.integration.test.ts` (new file)

**Interfaces:**
- Consumes: `listObligationsQuerySchema`, `generateObligationsQuerySchema`, `generateObligationsBodySchema`, `patchObligationSchema`, `createAdHocObligationSchema`, `OBLIGATION_STATUS_VALUES` (Tasks 1, 9); `ClientsService.findOne` (Phase 0); `ZodValidationPipe`, `SessionGuard` (Phase 0).
- Produces (consumed by Task 12, which wires this into `ObligationsModule`, and by `apps/web`):
  - `ObligationsService.list/findOne/patch/createAdHoc`
  - `GET /obligations`, `POST /obligations/generate`, `PATCH /obligations/:id`, `POST /obligations`

**Controller pipe placement:** every route below applies its `ZodValidationPipe`
at the parameter level (`@Query(new ZodValidationPipe(...))`,
`@Body(new ZodValidationPipe(...))`), never as a method-level `@UsePipes`.
Phase 1 (Tasks 5-7) discovered that a method-level pipe in this NestJS
version validates *every* resolved parameter of the handler, not just the
one it's meant for — silently breaking any handler that combines `@Body()`
with `@Param()`, `@Query()`, or a custom decorator. `generate` below has
both a query and a body parameter; keeping every route in this controller
consistently parameter-level avoids re-discovering that bug on a
case-by-case basis.

- [ ] **Step 1: Write the integration tests**

`apps/api/test/obligations.integration.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app.js'
import { resetDatabase } from './database.js'
import { authenticate } from './authenticate.js'

let app: INestApplication
let cookie: string[]

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

function post(path: string, body: Record<string, unknown> = {}) {
  return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq').send(body)
}

function patch(path: string, body: Record<string, unknown>) {
  return request(app.getHttpServer()).patch(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq').send(body)
}

async function createCompanyWithProfile() {
  const client = await post('/api/v1/clients', {
    kind: 'COMPANY',
    name: 'Padaria Central, Lda.',
    taxId: '501442600',
    accounting: 'ORGANIZED',
    legalForm: 'LDA',
  }).expect(201)

  await request(app.getHttpServer())
    .put(`/api/v1/clients/${client.body.id}/fiscal-profile`)
    .set('Cookie', cookie)
    .set('X-Requested-With', 'ledger-hq')
    .send({
      hasOpenActivity: true,
      vatRegime: 'MONTHLY',
      incomeTax: 'CIT',
      hasEmployees: false,
      hasWithholding: false,
      isVatCashBasis: false,
      startedAt: '2020-01-01',
    })
    .expect(200)

  return client.body.id as string
}

describe('obligation generation and listing', () => {
  it('generate with dryRun=true proposes instances without persisting them', async () => {
    const clientId = await createCompanyWithProfile()

    const dryRun = await post(`/api/v1/obligations/generate?dryRun=true`, { asOf: '2026-03-18', clientId }).expect(201)
    expect(dryRun.body.toCreate.length).toBeGreaterThan(0)

    const listed = await request(app.getHttpServer()).get('/api/v1/obligations').set('Cookie', cookie).expect(200)
    expect(listed.body).toEqual([])
  })

  it('generate with dryRun=false persists the proposed instances, then lists them', async () => {
    const clientId = await createCompanyWithProfile()

    await post(`/api/v1/obligations/generate?dryRun=false`, { asOf: '2026-03-18', clientId }).expect(201)

    const listed = await request(app.getHttpServer()).get('/api/v1/obligations').set('Cookie', cookie).expect(200)
    expect(listed.body.length).toBeGreaterThan(0)
    expect(listed.body[0]).toMatchObject({ clientId, status: 'PENDING' })
  })

  it('filters the list by clientId', async () => {
    const clientId = await createCompanyWithProfile()
    await post(`/api/v1/obligations/generate?dryRun=false`, { asOf: '2026-03-18', clientId }).expect(201)

    const listed = await request(app.getHttpServer())
      .get(`/api/v1/obligations?clientId=${clientId}`)
      .set('Cookie', cookie)
      .expect(200)
    expect(listed.body.length).toBeGreaterThan(0)
    expect(listed.body.every((item: { clientId: string }) => item.clientId === clientId)).toBe(true)
  })
})

describe('manual adjustment', () => {
  it('overriding the due date sets dueDateOverridden', async () => {
    const clientId = await createCompanyWithProfile()
    await post(`/api/v1/obligations/generate?dryRun=false`, { asOf: '2026-03-18', clientId }).expect(201)
    const listed = await request(app.getHttpServer()).get('/api/v1/obligations').set('Cookie', cookie).expect(200)
    const target = listed.body[0]

    const response = await patch(`/api/v1/obligations/${target.id}`, { dueDate: '2026-04-01' }).expect(200)

    expect(response.body.dueDate).toBe('2026-04-01')
    expect(response.body.dueDateOverridden).toBe(true)
  })

  it('rejects marking WAIVED with no reason', async () => {
    const clientId = await createCompanyWithProfile()
    await post(`/api/v1/obligations/generate?dryRun=false`, { asOf: '2026-03-18', clientId }).expect(201)
    const listed = await request(app.getHttpServer()).get('/api/v1/obligations').set('Cookie', cookie).expect(200)
    const target = listed.body[0]

    const response = await patch(`/api/v1/obligations/${target.id}`, { status: 'WAIVED' })

    expect(response.status).toBe(422)
  })

  it('accepts marking WAIVED with a reason', async () => {
    const clientId = await createCompanyWithProfile()
    await post(`/api/v1/obligations/generate?dryRun=false`, { asOf: '2026-03-18', clientId }).expect(201)
    const listed = await request(app.getHttpServer()).get('/api/v1/obligations').set('Cookie', cookie).expect(200)
    const target = listed.body[0]

    const response = await patch(`/api/v1/obligations/${target.id}`, { status: 'WAIVED', notes: 'Client ceased activity' }).expect(200)

    expect(response.body.status).toBe('WAIVED')
  })

  it('404s adjusting an unknown instance', async () => {
    await patch('/api/v1/obligations/00000000-0000-7000-8000-000000000099', { notes: 'x' }).expect(404)
  })
})

describe('ad-hoc obligations', () => {
  it('creates an ad-hoc obligation with its own CUSTOM definition', async () => {
    const clientId = await createCompanyWithProfile()

    const response = await post('/api/v1/obligations', {
      clientId,
      code: 'BACKUP_RESTORE_DRILL',
      name: 'Backup restore drill',
      periodicity: 'ONE_OFF',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-01',
      periodLabel: '2026',
      dueDate: '2026-06-30',
    }).expect(201)

    expect(response.body).toMatchObject({ clientId, definitionCode: 'BACKUP_RESTORE_DRILL', status: 'PENDING' })
  })

  it('rejects an ad-hoc code that collides with a CATALOG definition', async () => {
    const clientId = await createCompanyWithProfile()
    await post(`/api/v1/obligations/generate?dryRun=false`, { asOf: '2026-03-18', clientId }).expect(201) // seeds CATALOG definitions

    const response = await post('/api/v1/obligations', {
      clientId,
      code: 'VAT_MONTHLY_RETURN',
      name: 'Hijacked',
      periodicity: 'ONE_OFF',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-01',
      periodLabel: '2026',
      dueDate: '2026-06-30',
    })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('obligations.definition_code_taken')
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: FAIL — none of these routes exist yet.

- [ ] **Step 3: Add the CRUD methods to `ObligationsService`**

Add to `apps/api/src/obligations/obligations.service.ts` (after `generate`), and add the new imports/type at the top of the file:

```ts
import { AppError, OBLIGATION_STATUS_VALUES } from '@ledger-hq/domain'
import type {
  CreateAdHocObligationInput,
  ObligationStatus,
  PatchObligationInput,
} from '@ledger-hq/domain'
import type { Client, ObligationDefinition, ObligationInstance } from '../generated/prisma/client.js'
```

(Add these alongside the file's existing `@ledger-hq/domain` and `../generated/prisma/client.js` imports rather than duplicating the import lines.)

```ts
export type ObligationWithDefinition = ObligationInstance & { definition: ObligationDefinition; client: Client }
```

```ts
  async list(filters: { clientId?: string; status?: ObligationStatus[] }): Promise<ObligationWithDefinition[]> {
    return this.prisma.obligationInstance.findMany({
      where: {
        ...(filters.clientId ? { clientId: filters.clientId } : {}),
        status: { in: filters.status ?? ['PENDING', 'IN_PROGRESS'] },
      },
      include: { definition: true, client: true },
      orderBy: { dueDate: 'asc' },
    })
  }

  async findOne(id: string): Promise<ObligationWithDefinition> {
    const instance = await this.prisma.obligationInstance.findUnique({
      where: { id },
      include: { definition: true, client: true },
    })
    if (!instance) throw new AppError('common.not_found', {}, 404)
    return instance
  }

  async patch(id: string, input: PatchObligationInput): Promise<ObligationWithDefinition> {
    await this.findOne(id)

    await this.prisma.obligationInstance.update({
      where: { id },
      data: {
        ...(input.dueDate !== undefined ? { dueDate: new Date(`${input.dueDate}T00:00:00Z`), dueDateOverridden: true } : {}),
        ...(input.status !== undefined
          ? { status: input.status, completedAt: input.status === 'DONE' ? new Date() : null }
          : {}),
        ...(input.reference !== undefined ? { reference: input.reference } : {}),
        ...(input.amountCents !== undefined ? { amountCents: input.amountCents } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    })

    return this.findOne(id)
  }

  async createAdHoc(input: CreateAdHocObligationInput): Promise<ObligationWithDefinition> {
    await this.clients.findOne(input.clientId)

    const existingDefinition = await this.prisma.obligationDefinition.findUnique({ where: { code: input.code } })
    if (existingDefinition && existingDefinition.source === 'CATALOG') {
      throw new AppError('obligations.definition_code_taken', { code: input.code }, 409)
    }

    await this.prisma.obligationDefinition.upsert({
      where: { code: input.code },
      create: { code: input.code, name: input.name, authority: 'OTHER', periodicity: input.periodicity, source: 'CUSTOM', active: true },
      update: {},
    })

    return this.prisma.obligationInstance.create({
      data: {
        id: uuidv7(),
        clientId: input.clientId,
        definitionCode: input.code,
        periodStart: new Date(`${input.periodStart}T00:00:00Z`),
        periodEnd: new Date(`${input.periodEnd}T00:00:00Z`),
        periodLabel: input.periodLabel,
        dueDate: new Date(`${input.dueDate}T00:00:00Z`),
      },
      include: { definition: true, client: true },
    })
  }
```

- [ ] **Step 4: Implement the controller**

`apps/api/src/obligations/obligations.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { AppError, OBLIGATION_STATUS_VALUES } from '@ledger-hq/domain'
import {
  createAdHocObligationSchema,
  generateObligationsBodySchema,
  generateObligationsQuerySchema,
  listObligationsQuerySchema,
  patchObligationSchema,
} from '@ledger-hq/domain'
import type {
  CreateAdHocObligationInput,
  GenerateObligationsInput,
  GenerateObligationsQuery,
  ListObligationsQuery,
  ObligationStatus,
  PatchObligationInput,
} from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ObligationsService } from './obligations.service.js'
import type { GenerateResult, ObligationWithDefinition } from './obligations.service.js'

type ObligationResponse = {
  id: string
  clientId: string
  clientName: string
  definitionCode: string
  definitionName: string
  authority: string
  periodLabel: string
  dueDate: string
  dueDateOverridden: boolean
  status: string
  completedAt: string | null
  reference: string | null
  amountCents: number | null
  notes: string | null
}

function toResponse(instance: ObligationWithDefinition): ObligationResponse {
  return {
    id: instance.id,
    clientId: instance.clientId,
    clientName: instance.client.name,
    definitionCode: instance.definitionCode,
    definitionName: instance.definition.name,
    authority: instance.definition.authority,
    periodLabel: instance.periodLabel,
    dueDate: instance.dueDate.toISOString().slice(0, 10),
    dueDateOverridden: instance.dueDateOverridden,
    status: instance.status,
    completedAt: instance.completedAt?.toISOString() ?? null,
    reference: instance.reference,
    amountCents: instance.amountCents,
    notes: instance.notes,
  }
}

function parseStatuses(raw: string): ObligationStatus[] {
  const values = raw.split(',').map((value) => value.trim())
  for (const value of values) {
    if (!OBLIGATION_STATUS_VALUES.includes(value as ObligationStatus)) {
      throw new AppError('common.validation_failed', { issues: [{ path: 'status', code: 'common.validation_failed' }] }, 422)
    }
  }
  return values as ObligationStatus[]
}

@Controller()
@UseGuards(SessionGuard)
export class ObligationsController {
  constructor(private readonly obligations: ObligationsService) {}

  @Get('obligations')
  async list(
    @Query(new ZodValidationPipe(listObligationsQuerySchema)) query: ListObligationsQuery,
  ): Promise<ObligationResponse[]> {
    const status = query.status ? parseStatuses(query.status) : undefined
    return (await this.obligations.list({ clientId: query.clientId, status })).map(toResponse)
  }

  @Post('obligations/generate')
  async generate(
    @Query(new ZodValidationPipe(generateObligationsQuerySchema)) query: GenerateObligationsQuery,
    @Body(new ZodValidationPipe(generateObligationsBodySchema)) body: GenerateObligationsInput,
  ): Promise<GenerateResult> {
    const asOf = body.asOf ? new Date(`${body.asOf}T00:00:00Z`) : new Date()
    // Defaults to the safe option: an omitted or malformed `dryRun` never
    // applies. Only an explicit `dryRun=false` writes anything — the web
    // client (Task 13) always sends one explicitly; this default only
    // matters for a raw API call that forgets the query param.
    return this.obligations.generate({ asOf, clientId: body.clientId }, query.dryRun !== 'false')
  }

  @Patch('obligations/:id')
  async patch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchObligationSchema)) body: PatchObligationInput,
  ): Promise<ObligationResponse> {
    return toResponse(await this.obligations.patch(id, body))
  }

  @Post('obligations')
  async createAdHoc(
    @Body(new ZodValidationPipe(createAdHocObligationSchema)) body: CreateAdHocObligationInput,
  ): Promise<ObligationResponse> {
    return toResponse(await this.obligations.createAdHoc(body))
  }
}
```

- [ ] **Step 5: Run it, confirm it still fails**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: still FAIL — nothing is registered in a module yet (Task 12). Confirm
the failure is routing 404s, not a compile error, then move on.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @ledger-hq/api typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/obligations/obligations.service.ts apps/api/src/obligations/obligations.controller.ts \
  apps/api/test/obligations.integration.test.ts
git commit -m "feat(api): add obligation listing, manual adjustment, and ad-hoc creation"
```

---

### Task 12: Wire the module, add the daily cron, translate error codes

**Files:**
- Create: `apps/api/src/obligations/obligations.module.ts`
- Create: `apps/api/src/obligations/obligations.cron.ts`
- Create: `apps/api/src/obligations/obligations.cron.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/package.json` (add `@nestjs/schedule`)
- Modify: `apps/web/src/i18n/locales/pt/errors.json`, `apps/web/src/i18n/locales/en/errors.json`

**Interfaces:**
- Consumes: `ObligationsController/Service` (Tasks 10-11), `ClientsModule` (Phase 0).
- Produces: a registered `ObligationsModule` with a daily in-process cron — this is the task that turns Task 11's integration tests from 404s into passes.

`@nestjs/schedule` is the first in-process cron this codebase uses (the
existing backup job runs from the host's crontab entirely outside the
application — see this plan's "Decisions" section, and design doc 3.3).

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter @ledger-hq/api add @nestjs/schedule
```

- [ ] **Step 2: Write the cron wrapper's test**

`apps/api/src/obligations/obligations.cron.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { ObligationsService } from './obligations.service.js'
import { ObligationsCron } from './obligations.cron.js'

describe('ObligationsCron', () => {
  it('delegates to the service with dryRun=false and no clientId, so it sweeps every active client', async () => {
    const generate = vi.fn().mockResolvedValue({ toCreate: [], toRetract: [] })
    const service = { generate } as unknown as ObligationsService
    const cron = new ObligationsCron(service)

    await cron.runDailyGeneration()

    expect(generate).toHaveBeenCalledTimes(1)
    const [input, dryRun] = generate.mock.calls[0]!
    expect(dryRun).toBe(false)
    expect(input.clientId).toBeUndefined()
    expect(input.asOf).toBeInstanceOf(Date)
  })
})
```

This test is not a test of `@nestjs/schedule`'s own scheduler — it is a test
that the `@Cron()`-decorated method delegates to the already-tested service
logic (Task 10) correctly, the same way any other service method's caller
would be tested.

- [ ] **Step 3: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/api test -- obligations.cron`
Expected: FAIL — `./obligations.cron` does not exist.

- [ ] **Step 4: Implement the cron wrapper**

`apps/api/src/obligations/obligations.cron.ts`:

```ts
import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ObligationsService } from './obligations.service.js'

/**
 * Kept separate from `ObligationsService` so the service itself carries zero
 * `@nestjs/schedule` coupling and stays a plain, directly-testable class
 * like every other service in this codebase — only this thin wrapper knows
 * it runs on a schedule.
 */
@Injectable()
export class ObligationsCron {
  constructor(private readonly obligations: ObligationsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDailyGeneration(): Promise<void> {
    await this.obligations.generate({ asOf: new Date() }, false)
  }
}
```

- [ ] **Step 5: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/api test -- obligations.cron`
Expected: PASS.

- [ ] **Step 6: Create the module**

`apps/api/src/obligations/obligations.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AuthModule } from '../auth/auth.module.js'
import { ClientsModule } from '../clients/clients.module.js'
import { PrismaService } from '../common/prisma.service.js'
import { ObligationsController } from './obligations.controller.js'
import { ObligationsService } from './obligations.service.js'
import { ObligationsCron } from './obligations.cron.js'

@Module({
  imports: [AuthModule, ClientsModule, ScheduleModule.forRoot()],
  controllers: [ObligationsController],
  providers: [ObligationsService, ObligationsCron, PrismaService],
})
export class ObligationsModule {}
```

`ScheduleModule.forRoot()` is safe to call here even though it is a
commonly-global-registered module elsewhere in the NestJS ecosystem — Nest
deduplicates a module registered from more than one place, and this is the
only place in this codebase that needs it.

- [ ] **Step 7: Register it in `AppModule`**

Add to `apps/api/src/app.module.ts`'s imports (after `VaultModule`) and its
own import line:

```ts
import { ObligationsModule } from './obligations/obligations.module.js'
```

```ts
    VaultModule,
    ObligationsModule,
    SystemModule,
```

- [ ] **Step 8: Run every integration test file touched so far**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: PASS — `obligations.integration.test.ts` and
`schema-constraints.integration.test.ts`'s new case all green now that the
routes resolve.

- [ ] **Step 9: Translate the two new error codes**

Add to `apps/web/src/i18n/locales/pt/errors.json` (new top-level key,
alongside the existing `vault`/`platforms`/`credentials` blocks):

```json
  "obligations": {
    "waived_reason_required": "Indica o motivo da dispensa.",
    "definition_code_taken": "Já existe uma obrigação do catálogo com o código {{code}}."
  }
```

Add the equivalent to `apps/web/src/i18n/locales/en/errors.json`:

```json
  "obligations": {
    "waived_reason_required": "Enter a reason for waiving this obligation.",
    "definition_code_taken": "A catalog obligation with the code {{code}} already exists."
  }
```

- [ ] **Step 10: Verify locale parity**

Run: `pnpm --filter @ledger-hq/web i18n:check`
Expected: `Locale bundles agree on <N> keys.`

- [ ] **Step 11: Run the full monorepo check**

Run: `pnpm turbo run lint typecheck build test`
Expected: all green — this is this plan's first full-repo checkpoint.

- [ ] **Step 12: Commit**

```bash
git add apps/api/package.json apps/api/src/obligations/obligations.module.ts apps/api/src/obligations/obligations.cron.ts \
  apps/api/src/obligations/obligations.cron.test.ts apps/api/src/app.module.ts \
  apps/web/src/i18n/locales/pt/errors.json apps/web/src/i18n/locales/en/errors.json
git commit -m "feat(api): wire the obligations module in, with a daily generation cron"
```

---

### Task 13: Web API client and locales

**Files:**
- Create: `apps/web/src/obligations/api.ts`
- Create: `apps/web/src/i18n/locales/pt/obligations.json`, `apps/web/src/i18n/locales/en/obligations.json`
- Modify: `apps/web/src/i18n/locales/pt/domain.json`, `apps/web/src/i18n/locales/en/domain.json`
- Modify: `apps/web/src/i18n/locales/pt/index.ts`, `apps/web/src/i18n/locales/en/index.ts`

**Interfaces:**
- Consumes: `apiFetch` (Phase 0).
- Produces (consumed by Tasks 14-18):
  - `ObligationResponse`, `listObligations`, `generateObligations`, `patchObligation`, `createAdHocObligation` (all from `apps/web/src/obligations/api.ts`)
  - A registered `obligations` locale namespace, and new `authority`/`periodicity`/`obligationStatus` blocks in `domain.json`.

- [ ] **Step 1: Write the API client**

`apps/web/src/obligations/api.ts`:

```ts
import { apiFetch } from '../api/client'

export type ObligationResponse = {
  id: string
  clientId: string
  clientName: string
  definitionCode: string
  definitionName: string
  authority: string
  periodLabel: string
  dueDate: string
  dueDateOverridden: boolean
  status: string
  completedAt: string | null
  reference: string | null
  amountCents: number | null
  notes: string | null
}

export function listObligations(params: { clientId?: string; status?: string } = {}): Promise<ObligationResponse[]> {
  const query = [
    params.clientId ? `clientId=${encodeURIComponent(params.clientId)}` : null,
    params.status ? `status=${encodeURIComponent(params.status)}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join('&')

  return apiFetch<ObligationResponse[]>(`/obligations${query ? `?${query}` : ''}`)
}

export type GenerateObligationsResult = {
  toCreate: Array<{ clientId: string; definitionCode: string; periodLabel: string; dueDate: string }>
  toRetract: Array<{ clientId: string; definitionCode: string; periodLabel: string }>
}

export function generateObligations(
  input: { asOf?: string; clientId?: string },
  dryRun: boolean,
): Promise<GenerateObligationsResult> {
  return apiFetch<GenerateObligationsResult>(`/obligations/generate?dryRun=${dryRun}`, { method: 'POST', body: input })
}

export type PatchObligationInput = {
  dueDate?: string
  status?: string
  reference?: string
  amountCents?: number
  notes?: string
}

export function patchObligation(id: string, input: PatchObligationInput): Promise<ObligationResponse> {
  return apiFetch<ObligationResponse>(`/obligations/${id}`, { method: 'PATCH', body: input })
}

export type CreateAdHocObligationInput = {
  clientId: string
  code: string
  name: string
  periodicity: string
  periodStart: string
  periodEnd: string
  periodLabel: string
  dueDate: string
}

export function createAdHocObligation(input: CreateAdHocObligationInput): Promise<ObligationResponse> {
  return apiFetch<ObligationResponse>('/obligations', { method: 'POST', body: input })
}
```

- [ ] **Step 2: Add the domain enum translations**

Add to `apps/web/src/i18n/locales/pt/domain.json` (new top-level keys, alongside the existing `authKind` block):

```json
  "authority": {
    "TAX": "Autoridade Tributária",
    "SOCIAL_SECURITY": "Segurança Social",
    "REGISTRY": "Registo",
    "OTHER": "Outra"
  },
  "periodicity": {
    "MONTHLY": "Mensal",
    "QUARTERLY": "Trimestral",
    "ANNUAL": "Anual",
    "ONE_OFF": "Pontual"
  },
  "obligationStatus": {
    "PENDING": "Pendente",
    "IN_PROGRESS": "Em curso",
    "DONE": "Concluída",
    "WAIVED": "Dispensada"
  }
```

Add the equivalent to `apps/web/src/i18n/locales/en/domain.json`:

```json
  "authority": {
    "TAX": "Tax Authority",
    "SOCIAL_SECURITY": "Social Security",
    "REGISTRY": "Registry",
    "OTHER": "Other"
  },
  "periodicity": {
    "MONTHLY": "Monthly",
    "QUARTERLY": "Quarterly",
    "ANNUAL": "Annual",
    "ONE_OFF": "One-off"
  },
  "obligationStatus": {
    "PENDING": "Pending",
    "IN_PROGRESS": "In progress",
    "DONE": "Done",
    "WAIVED": "Waived"
  }
```

- [ ] **Step 3: Add the `obligations` locale namespace**

`apps/web/src/i18n/locales/pt/obligations.json`:

```json
{
  "dashboard": {
    "title": "Prazos",
    "overdue": "Atrasadas",
    "thisWeek": "Esta semana",
    "thisMonth": "Este mês",
    "later": "Mais tarde",
    "empty": "Sem obrigações pendentes."
  },
  "section": {
    "title": "Obrigações fiscais",
    "empty": "Ainda não há obrigações para este cliente.",
    "previewMessage": "{{toCreate}} a criar, {{toRetract}} a retirar",
    "apply": "Aplicar"
  },
  "row": {
    "markDone": "Marcar como feita",
    "edit": "Editar",
    "waive": "Dispensar"
  },
  "form": {
    "dueDate": { "label": "Prazo" },
    "status": { "label": "Estado" },
    "reference": { "label": "N.º de referência" },
    "amountCents": { "label": "Valor (€)" },
    "notes": { "label": "Notas" },
    "waiveReasonRequired": "Indica o motivo da dispensa."
  },
  "adHoc": {
    "newTitle": "Nova obrigação personalizada",
    "code": { "label": "Código" },
    "name": { "label": "Designação" },
    "periodicity": { "label": "Periodicidade" },
    "periodLabel": { "label": "Período" },
    "dueDate": { "label": "Prazo" }
  }
}
```

`apps/web/src/i18n/locales/en/obligations.json`:

```json
{
  "dashboard": {
    "title": "Deadlines",
    "overdue": "Overdue",
    "thisWeek": "This week",
    "thisMonth": "This month",
    "later": "Later",
    "empty": "No pending obligations."
  },
  "section": {
    "title": "Fiscal obligations",
    "empty": "There are no obligations for this client yet.",
    "previewMessage": "{{toCreate}} to create, {{toRetract}} to retract",
    "apply": "Apply"
  },
  "row": {
    "markDone": "Mark as done",
    "edit": "Edit",
    "waive": "Waive"
  },
  "form": {
    "dueDate": { "label": "Due date" },
    "status": { "label": "Status" },
    "reference": { "label": "Reference number" },
    "amountCents": { "label": "Amount (€)" },
    "notes": { "label": "Notes" },
    "waiveReasonRequired": "Enter a reason for waiving this obligation."
  },
  "adHoc": {
    "newTitle": "New ad-hoc obligation",
    "code": { "label": "Code" },
    "name": { "label": "Name" },
    "periodicity": { "label": "Periodicity" },
    "periodLabel": { "label": "Period" },
    "dueDate": { "label": "Due date" }
  }
}
```

- [ ] **Step 4: Register the namespace**

Modify `apps/web/src/i18n/locales/pt/index.ts` and `.../en/index.ts`: add
`import obligations from './obligations.json'` and add `obligations` to the
exported `resources` object, alongside `vault`.

- [ ] **Step 5: Verify locale parity**

Run: `pnpm --filter @ledger-hq/web i18n:check`
Expected: `Locale bundles agree on <N> keys.`

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/obligations/api.ts \
  apps/web/src/i18n/locales/pt/obligations.json apps/web/src/i18n/locales/en/obligations.json \
  apps/web/src/i18n/locales/pt/domain.json apps/web/src/i18n/locales/en/domain.json \
  apps/web/src/i18n/locales/pt/index.ts apps/web/src/i18n/locales/en/index.ts
git commit -m "feat(web): add the obligations API client and locale namespace"
```

---

### Task 14: `ObligationRow` — the shared row component

**Files:**
- Create: `apps/web/src/obligations/ObligationRow.tsx`
- Create: `apps/web/src/obligations/ObligationRow.test.tsx`

**Interfaces:**
- Consumes: `ObligationResponse` (Task 13); `patchObligation` (Task 13).
- Produces (consumed by Tasks 15-16): `ObligationRow` — one row, shared by the dashboard and the per-client section, so marking an obligation done looks and behaves identically everywhere it appears.

- [ ] **Step 1: Write the component test**

`apps/web/src/obligations/ObligationRow.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const { ObligationRow } = await import('./ObligationRow')

await initI18n()
await i18next.changeLanguage('pt-PT')

const baseObligation = {
  id: 'o1',
  clientId: 'c1',
  clientName: 'Padaria Central, Lda.',
  definitionCode: 'VAT_MONTHLY_RETURN',
  definitionName: 'Declaração periódica de IVA',
  authority: 'TAX',
  periodLabel: '2026-01',
  dueDate: '2026-03-20',
  dueDateOverridden: false,
  status: 'PENDING',
  completedAt: null,
  reference: null,
  amountCents: null,
  notes: null,
}

function renderRow(overrides: Partial<typeof baseObligation> = {}, props: { showClient?: boolean } = {}) {
  const onMarkDone = vi.fn()
  const onEdit = vi.fn()
  render(
    <I18nextProvider i18n={i18next}>
      <ObligationRow
        obligation={{ ...baseObligation, ...overrides }}
        showClient={props.showClient ?? false}
        onMarkDone={onMarkDone}
        onEdit={onEdit}
      />
    </I18nextProvider>,
  )
  return { onMarkDone, onEdit }
}

describe('ObligationRow', () => {
  it('shows the obligation name and due date', () => {
    renderRow()
    expect(screen.getByText(/declaração periódica de iva/i)).toBeInTheDocument()
    expect(screen.getByText('2026-03-20')).toBeInTheDocument()
  })

  it('shows the client name only when showClient is true', () => {
    renderRow({}, { showClient: false })
    expect(screen.queryByText(/padaria central/i)).not.toBeInTheDocument()
  })

  it('shows the client name when showClient is true', () => {
    renderRow({}, { showClient: true })
    expect(screen.getByText(/padaria central/i)).toBeInTheDocument()
  })

  it('calls onMarkDone when the mark-done button is clicked', async () => {
    const { onMarkDone } = renderRow()
    await userEvent.click(screen.getByRole('button', { name: /marcar como feita/i }))
    expect(onMarkDone).toHaveBeenCalledTimes(1)
  })

  it('hides the mark-done and edit actions once the obligation is DONE', () => {
    renderRow({ status: 'DONE' })
    expect(screen.queryByRole('button', { name: /marcar como feita/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^editar$/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- ObligationRow`
Expected: FAIL — `./ObligationRow` does not exist.

- [ ] **Step 3: Implement `ObligationRow`**

`apps/web/src/obligations/ObligationRow.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import type { ObligationResponse } from './api'

type Props = {
  obligation: ObligationResponse
  showClient: boolean
  onMarkDone: () => void
  /** Omitted on the global dashboard (mark-done only, per design doc 3.4); provided by the per-client section, which hosts the full manual-adjustment controls. */
  onEdit?: () => void
}

export function ObligationRow({ obligation, showClient, onMarkDone, onEdit }: Props) {
  const { t } = useTranslation('obligations')
  const isActionable = obligation.status === 'PENDING' || obligation.status === 'IN_PROGRESS'

  return (
    <li className="flex items-center justify-between gap-3 rounded border border-slate-200 bg-white p-3 text-sm">
      <span className="font-medium">
        {showClient ? `${obligation.clientName} — ` : ''}
        {obligation.definitionName}
      </span>
      <span className="text-slate-500">{obligation.dueDate}</span>

      {isActionable && (
        <div className="flex gap-2">
          {onEdit && (
            <button type="button" onClick={onEdit} className="text-xs underline">
              {t('row.edit')}
            </button>
          )}
          <button
            type="button"
            onClick={onMarkDone}
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          >
            {t('row.markDone')}
          </button>
        </div>
      )}
    </li>
  )
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- ObligationRow`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/obligations/ObligationRow.tsx apps/web/src/obligations/ObligationRow.test.tsx
git commit -m "feat(web): add the shared obligation row component"
```

---

### Task 15: `ObligationsDashboard` — the new home page

**Files:**
- Create: `apps/web/src/obligations/ObligationsDashboard.tsx`
- Create: `apps/web/src/obligations/ObligationsDashboard.test.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Consumes: `listObligations`, `patchObligation` (Task 13); `ObligationRow` (Task 14); `groupByUrgency` (`@ledger-hq/domain`, Task 4).
- Produces: `ObligationsDashboard`, replacing `indexRoute`'s current `component: () => null` placeholder.

This page needs a session, not an unlocked vault — obligation data is
plaintext metadata by design, the same reasoning Phase 1's platform catalog
already established (design doc 3.4).

- [ ] **Step 1: Write the dashboard test**

`apps/web/src/obligations/ObligationsDashboard.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const listObligationsMock = vi.hoisted(() => vi.fn())
const patchObligationMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ listObligations: listObligationsMock, patchObligation: patchObligationMock }))

const { ObligationsDashboard } = await import('./ObligationsDashboard')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ObligationsDashboard />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

const overdueObligation = {
  id: 'o1',
  clientId: 'c1',
  clientName: 'Padaria Central, Lda.',
  definitionCode: 'VAT_MONTHLY_RETURN',
  definitionName: 'Declaração periódica de IVA',
  authority: 'TAX',
  periodLabel: '2026-01',
  dueDate: '2020-01-01', // deep in the past relative to any real "today"
  dueDateOverridden: false,
  status: 'PENDING',
  completedAt: null,
  reference: null,
  amountCents: null,
  notes: null,
}

describe('ObligationsDashboard', () => {
  beforeEach(() => {
    listObligationsMock.mockReset()
    patchObligationMock.mockReset()
  })

  it('shows the empty state when there are no obligations', async () => {
    listObligationsMock.mockResolvedValue([])
    renderDashboard()
    expect(await screen.findByText(/sem obrigações pendentes/i)).toBeInTheDocument()
  })

  it('groups an overdue obligation under the "Atrasadas" section, with the client name shown', async () => {
    listObligationsMock.mockResolvedValue([overdueObligation])
    renderDashboard()

    expect(await screen.findByText(/atrasadas/i)).toBeInTheDocument()
    expect(screen.getByText(/padaria central/i)).toBeInTheDocument()
  })

  it('marking an obligation done calls patchObligation with status DONE', async () => {
    listObligationsMock.mockResolvedValue([overdueObligation])
    patchObligationMock.mockResolvedValue({ ...overdueObligation, status: 'DONE' })
    renderDashboard()

    await userEvent.click(await screen.findByRole('button', { name: /marcar como feita/i }))

    expect(patchObligationMock).toHaveBeenCalledWith('o1', { status: 'DONE' })
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- ObligationsDashboard`
Expected: FAIL — `./ObligationsDashboard` does not exist.

- [ ] **Step 3: Implement the dashboard**

`apps/web/src/obligations/ObligationsDashboard.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { groupByUrgency } from '@ledger-hq/domain'
import type { UrgencyGroup } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { listObligations, patchObligation } from './api'
import { ObligationRow } from './ObligationRow'

const SECTIONS: UrgencyGroup[] = ['overdue', 'thisWeek', 'thisMonth', 'later']

export function ObligationsDashboard() {
  const { t } = useTranslation('obligations')
  const queryClient = useQueryClient()

  const obligations = useQuery({ queryKey: ['obligations'], queryFn: () => listObligations() })

  const markDone = useMutation({
    mutationFn: (id: string) => patchObligation(id, { status: 'DONE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['obligations'] }),
  })

  if (obligations.isPending) return null
  if (obligations.isError) return <ErrorMessage error={obligations.error} />

  if (obligations.data.length === 0) {
    return (
      <section className="flex flex-col gap-6">
        <h1 className="text-lg font-semibold">{t('dashboard.title')}</h1>
        <p className="text-sm text-slate-600">{t('dashboard.empty')}</p>
      </section>
    )
  }

  const groups = groupByUrgency(obligations.data, new Date())

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">{t('dashboard.title')}</h1>

      {SECTIONS.filter((key) => groups[key].length > 0).map((key) => (
        <div key={key}>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">{t(`dashboard.${key}`)}</h2>
          <ul className="flex flex-col gap-2">
            {groups[key].map((obligation) => (
              <ObligationRow
                key={obligation.id}
                obligation={obligation}
                showClient
                onMarkDone={() => markDone.mutate(obligation.id)}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- ObligationsDashboard`
Expected: PASS.

- [ ] **Step 5: Wire it into the home route**

Modify `apps/web/src/router.tsx`: import `ObligationsDashboard` from
`'./obligations/ObligationsDashboard'` and replace the existing `indexRoute`'s
`component: () => null` with `component: ObligationsDashboard`. Every other
route in the file (including the ones Phase 1 added) stays untouched.

- [ ] **Step 6: Run the full web suite, typecheck, lint**

Run: `pnpm --filter @ledger-hq/web test && pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/obligations/ObligationsDashboard.tsx apps/web/src/obligations/ObligationsDashboard.test.tsx apps/web/src/router.tsx
git commit -m "feat(web): add the obligations dashboard as the app's home page"
```

---

### Task 16: `ObligationsSection` — per-client obligations, manual adjustment, and the regenerate preview

**Files:**
- Create: `apps/web/src/obligations/ObligationsSection.tsx`
- Create: `apps/web/src/obligations/AdjustObligationForm.tsx`
- Create: `apps/web/src/obligations/ObligationsSection.test.tsx`
- Modify: `apps/web/src/clients/ClientDetailPage.tsx`
- Modify: `apps/web/src/clients/FiscalProfileForm.tsx`

**Interfaces:**
- Consumes: `listObligations`, `generateObligations`, `patchObligation` (Task 13); `ObligationRow` (Task 14); `OBLIGATION_STATUS_VALUES` (`@ledger-hq/domain`, Task 1).
- Produces: `ObligationsSection`, rendered on `ClientDetailPage` immediately after `FiscalProfileForm`; `AdjustObligationForm`.

Unlike Task 15's dashboard, this section hosts the full manual-adjustment
controls (design doc 3.4) and a "regenerate preview" banner: it runs a
scoped (`clientId`-filtered) dry run on mount, and whenever `FiscalProfileForm`
saves successfully, so a profile edit's consequences are visible without a
page reload.

- [ ] **Step 1: Write the section test**

`apps/web/src/obligations/ObligationsSection.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const listObligationsMock = vi.hoisted(() => vi.fn())
const generateObligationsMock = vi.hoisted(() => vi.fn())
const patchObligationMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({
  listObligations: listObligationsMock,
  generateObligations: generateObligationsMock,
  patchObligation: patchObligationMock,
}))

const { ObligationsSection } = await import('./ObligationsSection')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ObligationsSection clientId="c1" />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

const obligation = {
  id: 'o1',
  clientId: 'c1',
  clientName: 'Padaria Central, Lda.',
  definitionCode: 'VAT_MONTHLY_RETURN',
  definitionName: 'Declaração periódica de IVA',
  authority: 'TAX',
  periodLabel: '2026-01',
  dueDate: '2026-03-20',
  dueDateOverridden: false,
  status: 'PENDING',
  completedAt: null,
  reference: null,
  amountCents: null,
  notes: null,
}

describe('ObligationsSection', () => {
  beforeEach(() => {
    listObligationsMock.mockReset()
    generateObligationsMock.mockReset().mockResolvedValue({ toCreate: [], toRetract: [] })
    patchObligationMock.mockReset()
  })

  it('shows the empty state when there are no obligations and no preview diff', async () => {
    listObligationsMock.mockResolvedValue([])
    renderSection()
    expect(await screen.findByText(/ainda não há obrigações/i)).toBeInTheDocument()
  })

  it('lists an obligation without the client name (showClient=false)', async () => {
    listObligationsMock.mockResolvedValue([obligation])
    renderSection()
    expect(await screen.findByText(/declaração periódica de iva/i)).toBeInTheDocument()
    expect(screen.queryByText(/padaria central/i)).not.toBeInTheDocument()
  })

  it('shows a preview banner with an Apply button when the dry run proposes changes', async () => {
    listObligationsMock.mockResolvedValue([])
    generateObligationsMock.mockResolvedValue({
      toCreate: [{ clientId: 'c1', definitionCode: 'VAT_MONTHLY_RETURN', periodLabel: '2026-02', dueDate: '2026-04-20' }],
      toRetract: [],
    })
    renderSection()

    expect(await screen.findByRole('button', { name: /aplicar/i })).toBeInTheDocument()
  })

  it('clicking Apply calls generateObligations with dryRun=false', async () => {
    listObligationsMock.mockResolvedValue([])
    generateObligationsMock.mockResolvedValueOnce({
      toCreate: [{ clientId: 'c1', definitionCode: 'VAT_MONTHLY_RETURN', periodLabel: '2026-02', dueDate: '2026-04-20' }],
      toRetract: [],
    })
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /aplicar/i }))

    expect(generateObligationsMock).toHaveBeenLastCalledWith({ clientId: 'c1' }, false)
  })

  it('opening the edit form and submitting a due-date change calls patchObligation', async () => {
    listObligationsMock.mockResolvedValue([obligation])
    patchObligationMock.mockResolvedValue({ ...obligation, dueDate: '2026-04-01' })
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^editar$/i }))
    const dueDateInput = screen.getByLabelText(/prazo/i)
    await userEvent.clear(dueDateInput)
    await userEvent.type(dueDateInput, '2026-04-01')
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }))

    expect(patchObligationMock).toHaveBeenCalledWith('o1', expect.objectContaining({ dueDate: '2026-04-01' }))
  })

  it('blocks submitting WAIVED with no notes', async () => {
    listObligationsMock.mockResolvedValue([obligation])
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^editar$/i }))
    await userEvent.selectOptions(screen.getByLabelText(/estado/i), 'WAIVED')
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }))

    expect(patchObligationMock).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/indica o motivo/i)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- ObligationsSection`
Expected: FAIL — neither component exists yet.

- [ ] **Step 3: Implement `AdjustObligationForm`**

`apps/web/src/obligations/AdjustObligationForm.tsx`:

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { OBLIGATION_STATUS_VALUES } from '@ledger-hq/domain'
import type { ObligationStatus } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { patchObligation } from './api'
import type { ObligationResponse } from './api'

type Props = { obligation: ObligationResponse; onClose: () => void; onSaved: () => void }

export function AdjustObligationForm({ obligation, onClose, onSaved }: Props) {
  const { t } = useTranslation(['obligations', 'domain', 'common'])
  const [dueDate, setDueDate] = useState(obligation.dueDate)
  const [status, setStatus] = useState<ObligationStatus>(obligation.status as ObligationStatus)
  const [notes, setNotes] = useState(obligation.notes ?? '')

  const waivedWithoutReason = status === 'WAIVED' && notes.trim() === ''

  const mutation = useMutation({
    mutationFn: () =>
      patchObligation(obligation.id, {
        ...(dueDate !== obligation.dueDate ? { dueDate } : {}),
        ...(status !== obligation.status ? { status } : {}),
        ...(notes !== (obligation.notes ?? '') ? { notes } : {}),
      }),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })

  return (
    <form
      className="flex flex-col gap-3 rounded border border-slate-200 bg-white p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (waivedWithoutReason) return
        mutation.mutate()
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:form.dueDate.label')}
        <input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:form.status.label')}
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as ObligationStatus)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          {OBLIGATION_STATUS_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`domain:obligationStatus.${value}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:form.notes.label')}
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      {waivedWithoutReason && (
        <p role="alert" className="text-sm text-red-700">
          {t('obligations:form.waiveReasonRequired')}
        </p>
      )}

      <ErrorMessage error={mutation.error} />

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={mutation.isPending || waivedWithoutReason}
          className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {t('common:actions.save')}
        </button>
        <button type="button" onClick={onClose} className="rounded border border-slate-300 px-3 py-2 text-sm">
          {t('common:actions.cancel')}
        </button>
      </div>
    </form>
  )
}
```

Check `apps/web/src/i18n/locales/{pt,en}/common.json`'s existing `actions`
object for `save`/`cancel` keys before assuming they exist; if either is
missing, add it there (not to `obligations.json` — these are generic,
shared action labels, the same object `actions.create`/`actions.archive`
already live in).

- [ ] **Step 4: Implement `ObligationsSection`**

`apps/web/src/obligations/ObligationsSection.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { generateObligations, listObligations, patchObligation } from './api'
import type { ObligationResponse } from './api'
import { AdjustObligationForm } from './AdjustObligationForm'
import { ObligationRow } from './ObligationRow'

export function ObligationsSection({ clientId }: { clientId: string }) {
  const { t } = useTranslation('obligations')
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ObligationResponse | null>(null)

  const obligations = useQuery({
    queryKey: ['obligations', clientId],
    queryFn: () => listObligations({ clientId }),
  })

  const preview = useQuery({
    queryKey: ['obligations-preview', clientId],
    queryFn: () => generateObligations({ clientId }, true),
  })

  const markDone = useMutation({
    mutationFn: (id: string) => patchObligation(id, { status: 'DONE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['obligations', clientId] }),
  })

  const apply = useMutation({
    mutationFn: () => generateObligations({ clientId }, false),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['obligations', clientId] })
      await queryClient.invalidateQueries({ queryKey: ['obligations-preview', clientId] })
    },
  })

  const hasPendingChanges = (preview.data?.toCreate.length ?? 0) > 0 || (preview.data?.toRetract.length ?? 0) > 0

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t('section.title')}</h2>

      {hasPendingChanges && preview.data && (
        <div className="flex items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <span>
            {t('section.previewMessage', {
              toCreate: preview.data.toCreate.length,
              toRetract: preview.data.toRetract.length,
            })}
          </span>
          <button
            type="button"
            onClick={() => apply.mutate()}
            disabled={apply.isPending}
            className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
          >
            {t('section.apply')}
          </button>
        </div>
      )}

      <ErrorMessage error={apply.error} />

      {obligations.isPending ? null : obligations.isError ? (
        <ErrorMessage error={obligations.error} />
      ) : obligations.data.length === 0 ? (
        <p className="text-sm text-slate-600">{t('section.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {obligations.data.map((obligation) => (
            <ObligationRow
              key={obligation.id}
              obligation={obligation}
              showClient={false}
              onMarkDone={() => markDone.mutate(obligation.id)}
              onEdit={() => setEditing(obligation)}
            />
          ))}
        </ul>
      )}

      {editing && (
        <AdjustObligationForm
          obligation={editing}
          onClose={() => setEditing(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['obligations', clientId] })}
        />
      )}
    </section>
  )
}
```

- [ ] **Step 5: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- ObligationsSection`
Expected: PASS.

- [ ] **Step 6: Render it on `ClientDetailPage`, immediately after `FiscalProfileForm`**

Modify `apps/web/src/clients/ClientDetailPage.tsx`: import `ObligationsSection`
from `'../obligations/ObligationsSection'`, and render
`<ObligationsSection clientId={clientId} />` immediately after the
`{fiscalProfile.isPending ? null : ... <FiscalProfileForm ... />}` block,
before `<EmploymentSection ... />`.

- [ ] **Step 7: Make `FiscalProfileForm` invalidate the obligations preview on save**

Modify `apps/web/src/clients/FiscalProfileForm.tsx`'s `mutation`'s `onSuccess`:

```ts
  const mutation = useMutation({
    mutationFn: (input: FiscalProfileInput) => putFiscalProfile(clientId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fiscal-profile', clientId] })
      await queryClient.invalidateQueries({ queryKey: ['obligations-preview', clientId] })
    },
  })
```

So a saved profile change immediately re-runs `ObligationsSection`'s scoped
dry run, surfacing the preview banner without a page reload — the "preview
of the changes before confirmation" trigger design doc 3.2 and the master
spec (7.3) both describe.

- [ ] **Step 8: Verify locale parity and run the full web suite**

Run: `pnpm --filter @ledger-hq/web i18n:check && pnpm --filter @ledger-hq/web test`
Expected: both green.

- [ ] **Step 9: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: both clean.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/obligations/ObligationsSection.tsx apps/web/src/obligations/AdjustObligationForm.tsx \
  apps/web/src/obligations/ObligationsSection.test.tsx \
  apps/web/src/clients/ClientDetailPage.tsx apps/web/src/clients/FiscalProfileForm.tsx \
  apps/web/src/i18n/locales/pt/common.json apps/web/src/i18n/locales/en/common.json
git commit -m "feat(web): show per-client obligations with manual adjustment and a regenerate preview"
```

---

### Task 17: `AddAdHocObligationForm` — creating an obligation outside the catalog

**Files:**
- Create: `apps/web/src/obligations/AddAdHocObligationForm.tsx`
- Modify: `apps/web/src/obligations/ObligationsSection.tsx`
- Modify: `apps/web/src/obligations/ObligationsSection.test.tsx`

**Interfaces:**
- Consumes: `createAdHocObligation` (Task 13); `PERIODICITY_VALUES` (`@ledger-hq/domain`, Task 1).
- Produces: `AddAdHocObligationForm`, rendered inside `ObligationsSection` alongside the existing list.

- [ ] **Step 1: Add a test case for the ad-hoc form to `ObligationsSection.test.tsx`**

Add to `apps/web/src/obligations/ObligationsSection.test.tsx`'s mock setup and
its `describe` block:

```ts
const createAdHocObligationMock = vi.hoisted(() => vi.fn())
```

Add `createAdHocObligation: createAdHocObligationMock` to the file's existing
`vi.mock('./api', () => ({ ... }))` object, and add
`createAdHocObligationMock.mockReset()` to the existing `beforeEach`. Then
add this case inside `describe('ObligationsSection', ...)`:

```ts
  it('creates an ad-hoc obligation with the entered fields', async () => {
    listObligationsMock.mockResolvedValue([])
    createAdHocObligationMock.mockResolvedValue({ ...obligation, id: 'o2', definitionCode: 'BACKUP_RESTORE_DRILL' })
    renderSection()

    await userEvent.type(await screen.findByLabelText(/código/i), 'BACKUP_RESTORE_DRILL')
    await userEvent.type(screen.getByLabelText(/designação/i), 'Backup restore drill')
    await userEvent.type(screen.getByLabelText(/período/i), '2026')
    await userEvent.type(screen.getByLabelText(/prazo/i), '2026-06-30')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    await vi.waitFor(() =>
      expect(createAdHocObligationMock).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'c1', code: 'BACKUP_RESTORE_DRILL', name: 'Backup restore drill' }),
      ),
    )
  })
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- ObligationsSection`
Expected: FAIL — `createAdHocObligation` is not exported from the mocked `./api` yet in the component itself, and `AddAdHocObligationForm` does not exist.

- [ ] **Step 3: Implement `AddAdHocObligationForm`**

`apps/web/src/obligations/AddAdHocObligationForm.tsx`:

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PERIODICITY_VALUES } from '@ledger-hq/domain'
import type { Periodicity } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { createAdHocObligation } from './api'

type Props = { clientId: string; onCreated: () => void }

export function AddAdHocObligationForm({ clientId, onCreated }: Props) {
  const { t } = useTranslation(['obligations', 'domain', 'common'])
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [periodicity, setPeriodicity] = useState<Periodicity>('ONE_OFF')
  const [periodLabel, setPeriodLabel] = useState('')
  const [dueDate, setDueDate] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      createAdHocObligation({
        clientId,
        code,
        name,
        periodicity,
        periodStart: dueDate,
        periodEnd: dueDate,
        periodLabel,
        dueDate,
      }),
    onSuccess: () => {
      setCode('')
      setName('')
      setPeriodLabel('')
      setDueDate('')
      onCreated()
    },
  })

  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <h3 className="font-medium">{t('obligations:adHoc.newTitle')}</h3>

      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:adHoc.code.label')}
        <input required value={code} onChange={(event) => setCode(event.target.value)} className="rounded border border-slate-300 px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:adHoc.name.label')}
        <input required value={name} onChange={(event) => setName(event.target.value)} className="rounded border border-slate-300 px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:adHoc.periodicity.label')}
        <select
          value={periodicity}
          onChange={(event) => setPeriodicity(event.target.value as Periodicity)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          {PERIODICITY_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`domain:periodicity.${value}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:adHoc.periodLabel.label')}
        <input
          required
          value={periodLabel}
          onChange={(event) => setPeriodLabel(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('obligations:adHoc.dueDate.label')}
        <input
          type="date"
          required
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <ErrorMessage error={mutation.error} />

      <button
        type="submit"
        disabled={mutation.isPending}
        className="self-start rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {t('common:actions.create')}
      </button>
    </form>
  )
}
```

`periodStart`/`periodEnd` are both set to the same `dueDate` value for a
one-off ad-hoc obligation — there is no separate period concept the form
needs to expose, since `ONE_OFF` periodicity means "this exists once,
whenever it's due," not a recurring window.

- [ ] **Step 4: Render it inside `ObligationsSection`**

Modify `apps/web/src/obligations/ObligationsSection.tsx`: import
`AddAdHocObligationForm` and render it at the end of the section, after the
`{editing && <AdjustObligationForm ... />}` block:

```tsx
      <AddAdHocObligationForm
        clientId={clientId}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['obligations', clientId] })}
      />
```

- [ ] **Step 5: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- ObligationsSection`
Expected: PASS.

- [ ] **Step 6: Verify locale parity and run the full web suite**

Run: `pnpm --filter @ledger-hq/web i18n:check && pnpm --filter @ledger-hq/web test`
Expected: both green.

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/obligations/AddAdHocObligationForm.tsx apps/web/src/obligations/ObligationsSection.tsx \
  apps/web/src/obligations/ObligationsSection.test.tsx
git commit -m "feat(web): add ad-hoc obligation creation outside the catalog"
```

---

### Task 18: End-to-end obligations test

**Files:**
- Create: `apps/web/e2e/obligations.spec.ts`

**Interfaces:**
- Consumes: the whole obligations UI (Tasks 13-17), exercised end-to-end.
- Produces: the generate → dashboard → adjust flow, proving the pieces built in isolation across 17 tasks actually compose into the feature the master spec and design doc describe.

`apps/web/playwright.config.ts` already runs with `workers: 1` (Phase 1's
`fix/phase-1-vault-followups` branch) specifically because two existing
specs both perform this app's one-time account bootstrap; this third spec
does too, and the existing serialization already covers it — no further
config change needed.

- [ ] **Step 1: Write the spec**

`apps/web/e2e/obligations.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

const MASTER_PASSWORD = 'a sufficiently long master password'

test('sets up a company, generates obligations, sees them on the dashboard, and adjusts one', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel(/email/i).fill('paulo@example.com')
  await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
  await page.getByLabel(/confirma/i).fill(MASTER_PASSWORD)
  await page.getByRole('button', { name: /criar|entrar/i }).click()
  await expect(page.getByRole('link', { name: /clientes/i })).toBeVisible()

  // Register a company client with an open, monthly-VAT fiscal profile.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Padaria Central, Lda.')
  await page.getByLabel(/^nif$/i).fill('501442600')
  await page.getByRole('button', { name: /guardar/i }).click()
  await expect(page.getByText('Padaria Central, Lda.')).toBeVisible()

  await page.getByRole('button', { name: /guardar/i }).click() // saves the fiscal profile's own defaults, which already imply COMPANY/MONTHLY

  // The regenerate preview banner should appear once the profile exists.
  await expect(page.getByRole('button', { name: /aplicar/i })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /aplicar/i }).click()
  await expect(page.getByText(/declaração periódica de iva/i)).toBeVisible()

  // The home dashboard now shows the same obligation, grouped by urgency.
  await page.goto('/')
  await expect(page.getByText(/declaração periódica de iva/i)).toBeVisible()
  await expect(page.getByText(/padaria central/i)).toBeVisible()

  // Marking it done removes it from the dashboard's pending view.
  await page.getByRole('button', { name: /marcar como feita/i }).first().click()
  await expect(page.getByText(/declaração periódica de iva/i)).not.toBeVisible()

  // Back on the client page, adjust a different obligation's due date.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: 'Padaria Central, Lda.' }).click()
  await page.getByRole('button', { name: /^editar$/i }).first().click()
  await page.getByLabel(/prazo/i).fill('2026-12-31')
  await page.getByRole('button', { name: /guardar/i }).click()
  await expect(page.getByText('2026-12-31')).toBeVisible()
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @ledger-hq/web test:e2e -- obligations`
Expected: PASS. As with Phase 1's own e2e task, a selector mismatch here is
corrected in the test file against the actual rendered copy, not by
changing application code — this is where a guessed label (`.first()`
disambiguation, an exact vs. fuzzy button name) gets fixed against reality.

- [ ] **Step 3: Run the full test suite one more time**

Run: `pnpm turbo run lint typecheck build test`, then
`pnpm --filter @ledger-hq/api test:integration`, then
`pnpm --filter @ledger-hq/web test:e2e` (the full suite, all specs — confirm
the two Phase 1 specs and this new one all still pass together at
`workers: 1`).
Expected: everything green — this is the last task before the whole-branch
review.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/obligations.spec.ts
git commit -m "test(e2e): cover fiscal-profile-driven obligation generation and adjustment"
```

---

### Task 19: Documentation

**Files:**
- Create: `docs/adr/0006-obligation-catalog-encoding.md`
- Modify: `README.md` (if it lists phase status)

**Interfaces:** none — this task changes no code.

Unlike Phase 1, this phase introduces no new security-relevant behavior (no
new secrets, no new crypto) — `docs/security-model.md` needs no update.
What does need recording is this plan's own rule-encoding decisions, the
same way Phase 1's ADR 0005 recorded the recovery-verification decision the
master spec's crypto section left unspecified.

- [ ] **Step 1: Confirm the ADR numbering**

Run: `ls docs/adr/`
Expected: `0001-...md` through `0005-...md` already exist (Phase 0's three
foundational ADRs plus Phase 1's `0005-recovery-code-verification.md`).
Confirm `0006` is genuinely the next number before creating the file below —
if the actual highest number differs from 5 at the time this task runs
(another ADR having landed on `master` in the meantime), use the real next
number instead and adjust the filename accordingly.

- [ ] **Step 2: Write the ADR**

`docs/adr/0006-obligation-catalog-encoding.md`:

```markdown
# 6. Encoding the fiscal catalog's ambiguous master-spec entries

## Status

Accepted.

## Context

The master spec's initial catalog table (section 7.5) gives 14 rows, three
of which do not map cleanly onto one `ObligationDefinition` row with one
`dueDate` rule:

- `VAT_PAYMENT` is listed once, but this catalog already splits its sibling
  `VAT_MONTHLY_RETURN`/`VAT_QUARTERLY_RETURN` by `vatRegime` — a client's
  VAT payment obligation follows whichever regime their return does, so a
  single undifferentiated `VAT_PAYMENT` code would either double-fire (if
  conditioned on `hasOpenActivity` alone, matching both regimes) or need a
  regime-conditional deadline a single `DeadlineRule` cannot express.
- `CIT_PAYMENT_ON_ACCOUNT` lists three distinct calendar deadlines ("July,
  September, 15 December") under one code, but `ObligationInstance` has
  exactly one `dueDate` column.
- `MODEL_30_NON_RESIDENT_PAYMENTS`'s "end of the 2nd following month" is not
  a fixed day-of-month; reusing a `day: 31` rule would silently roll over
  into the following month whenever the target month has fewer than 31 days.

## Decision

1. `VAT_PAYMENT` becomes two codes, `VAT_PAYMENT_MONTHLY` and
   `VAT_PAYMENT_QUARTERLY`, mirroring the return's own split exactly (same
   `vatRegime` conditions, same periodicities).
2. `CIT_PAYMENT_ON_ACCOUNT` becomes three annual codes,
   `CIT_PAYMENT_ON_ACCOUNT_1`/`_2`/`_3`, one per statutory payment.
3. A third `DeadlineRule` variant, `lastDayOfMonthAfterPeriodEnd`, joins
   `dayOfMonthAfterPeriodEnd` and `fixedDate` — computed via `Date.UTC(year,
   month + 1, 0)`, which JavaScript resolves to the last day of `month`
   regardless of its length, the same idiom used for Phase 0/1's other
   calendar-date arithmetic (`new Date(\`${value}T00:00:00Z\`)`).
4. `ObligationDefinition` rows are upserted by the generator itself
   (`syncCatalogDefinitions`, run at the start of every `generate` call), not
   seeded by a migration — unlike Phase 1's three fixed `Platform` seed rows,
   this catalog is expected to grow over the life of the practice, and a
   migration-time seed would drift the moment a code is added to the catalog
   file without an accompanying migration.

## Alternatives considered

- **Model `CIT_PAYMENT_ON_ACCOUNT` as one code with a `DeadlineRule` variant
  carrying multiple dates, generating three instances per period.**
  Rejected: every other multi-instance-per-period case in this domain (the
  monthly vs. quarterly VAT split) is already handled by separate codes, and
  a "one code, many instances" shape would need its own, unique generator
  branch just for this rule.
- **Seed `ObligationDefinition` at migration time, like `Platform`.**
  Rejected: `Platform`'s three rows are a small, genuinely fixed catalog (a
  government portal doesn't appear or disappear); the fiscal catalog is
  explicitly expected to be corrected and extended as legislation changes
  (design doc 3.1), which a migration-time seed cannot track.

## Consequences

- 18 catalog entries instead of the master spec's literal 14 — three codes
  became six (`VAT_PAYMENT`→2, `CIT_PAYMENT_ON_ACCOUNT`→3, net +4 minus the
  1 each replaced), which the owner's line-by-line review (design doc 3.1)
  covers the same as any other entry; the split itself, not just each
  entry's dates, is one more thing worth that review confirming.
- `syncCatalogDefinitions` runs on every `generate` call (dry-run and apply
  alike) — an 18-row upsert, negligible cost against the rest of the sweep.
```

- [ ] **Step 3: Check `README.md` for a phase-status line**

If `README.md` states Phase 0/1 are the only implemented phases, update that
line to also mention Phase 2 (Obligations). If it names no phase status at
all, skip this step — nothing to correct.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0006-obligation-catalog-encoding.md README.md
git commit -m "docs: record the fiscal-catalog encoding decisions this phase made"
```

---
