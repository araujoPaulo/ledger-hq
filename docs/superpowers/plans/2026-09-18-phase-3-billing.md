# Phase 3 — Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer "who owes what, and for how long" — retainer plans, monthly charge generation, payment recording with FIFO allocation, ad-hoc charges, write-offs, and three read views (per-client ledger, global receivables, current-month), integrated into the existing obligations home page as a second section.

**Architecture:** Same three-layer shape as Phase 2's obligation engine: a pure allocation function and pure period helpers in `packages/domain`, an idempotent generator plus CRUD service in `apps/api`, and forms/views in `apps/web` that reuse the dry-run/apply and query-key conventions Phase 2 already established. `billing` and `obligations` never import from each other — the only place they meet is the home page component, which composes both.

**Tech Stack:** NestJS 12, Prisma 7 (raw SQL for the `charge_balances` view — Prisma has no first-class support for authoring database views), PostgreSQL 18 (`btree_gist`, already enabled since Phase 0's `Employment` model), Zod 4, React 19.2, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-09-17-phase-3-billing-design.md` (this phase's own design doc, approved) and `docs/superpowers/specs/2026-09-04-ledger-hq-design.md` §6.6 and §8 (the master spec section the design doc itself elaborates — read both; the master spec has the schema and the allocation/generation algorithms in prose, the design doc has the API shape and UI flows this plan turns into code).

## Global Constraints

- `amountCents` everywhere is a plain `Int` — gross, EUR, no VAT/base split (master spec §8.1's stated assumption, unchanged).
- Every write endpoint that has a destructive or bulk effect defaults to the safe option when a query param is omitted or malformed. Charge generation: `dryRun !== 'false'` (never `=== 'true'`) — same ruling Phase 2 made for the same reason (an omitted param on a raw API call must never silently apply).
- Controller convention (established in Phase 1, reinforced in Phase 2): always `@Body(new ZodValidationPipe(...))` / `@Query(new ZodValidationPipe(...))` at the **parameter** level. Never `@UsePipes(...)` at the method level — that validates every handler parameter against one schema, including ones it was never meant to check.
- **Postgres `SUM()`/`COUNT()` over an `Int` column returns `bigint`.** `prisma.$queryRaw` hands that back as a JS `bigint`, which NestJS's JSON serializer throws on (`TypeError: Do not know how to serialize a BigInt`). Every aggregate in this plan's raw SQL — the `charge_balances` view itself and every query built on top of it — casts explicitly with `::int`. Task 5 below is the one place this must not be forgotten; every later task that reads from `charge_balances` inherits a clean `int`.
- Pure functions (period math, allocation) never call `Date.now()`. The current date is always a parameter, mirroring the obligation resolver's own discipline (Phase 2 plan, Task 3) — an allocation or period calculation that quietly depends on the wall clock cannot be tested against a fixed date.
- `packages/domain`'s `tsconfig.base.json` has `noUncheckedIndexedAccess: true` and `exactOptionalPropertyTypes: true`. Two concrete, previously-hit consequences to expect and handle inline rather than rediscover:
  - Destructuring a `.split(...)`/array index (e.g. parsing a period label) produces `T | undefined` per element — cast the destructured tuple (`as [number, number, number]`) with a one-line comment on why it's safe, the pattern Phase 2's `group-by-urgency.ts` settled on. Don't use a non-null assertion (`!`) instead — Phase 2's review flagged that as a style inconsistency once and it's not worth reintroducing.
  - Assigning a `T | undefined` value straight into an object literal typed with an optional property (`{ clientId?: string }`) fails to typecheck. Build the object with a conditional spread instead: `{ ...(value !== undefined ? { clientId: value } : {}) }` — the exact pattern `obligations.controller.ts`'s `list`/`generate` and `obligations.service.ts`'s `patch` already use.
- After changing `packages/domain`, run `pnpm --filter @ledger-hq/domain build` before typechecking `apps/api` — the API's typecheck resolves `@ledger-hq/domain` through its built `dist/`, and `prisma migrate dev` does not always trigger a Prisma Client regeneration reliably in this setup either; if a newly-added model's generated type is missing, run `pnpm exec prisma generate` explicitly (both gotchas rediscovered during Phase 2's Tasks 8 and 11).
- `ScheduleModule.forRoot()` is called exactly once in this codebase already (`ObligationsModule`, Phase 2 Task 12). `@nestjs/schedule`'s cron discovery scans every provider across the whole app once `forRoot()` has been bootstrapped anywhere — a second feature module does not need to call it again, and must not: `BillingModule` registers `BillingCron` as a plain provider with no `ScheduleModule` import at all (see Task 10's preflight note below).
- i18n: no catalog in this phase, so every billing string — labels, ledger entry types, ageing bucket names, error messages — lives in a new `billing.json` namespace (already reserved in the master spec's repository layout list, §13/§9). Enum values (`ChargeKind`, `PaymentMethod`) live in the shared `domain` namespace, next to `authority`/`periodicity`/`obligationStatus` — same split Phase 2 made (design doc §3.7).

## Preflight scan

18 tasks, same backend-first shape as Phase 2: pure domain (1-4) → schema (5) → service (6-8) → controller/module (9-10) → web (11-16) → E2E/docs (17-18).

| Check | Finding |
|---|---|
| Task 3's `proposeAllocation` input shape vs Task 7's caller | `proposeAllocation(paymentAmountCents: number, openCharges: ChargeBalance[]): ProposedAllocation[]` — Task 7's `proposeAllocationForClient` reads `openCharges` straight from the `charge_balances` raw-SQL query (Task 8), so the `ChargeBalance` type (Task 2) is shared verbatim between the pure function's input and the SQL query's declared row type. Verified the field names match exactly (`id`, `dueOn`, `outstandingCents`) before writing either task. |
| Task 2's `chargePeriodsSince`/`chargeDueDate` vs Task 6's generator | Confirmed during authoring that reusing Phase 2's `generatePeriods` (obligation resolver) for charges was tempting but wrong: that function's `[from, to]` windowing semantics are tuned for obligations' 12-month-ahead horizon, not billing's "born when the period begins, never in advance" rule (master spec §8.1). Task 2 writes a dedicated, simpler pair of pure functions instead of stretching an obligations-shaped tool to fit — see Task 2's own rationale. |
| Task 5's `charge_balances` view vs Task 8's raw queries | Every column Task 8's `getReceivables`/`getCurrentMonth`/`getClientLedger` reference (`clientId`, `kind`, `periodLabel`, `dueOn`, `amountCents`, `allocatedCents`, `outstandingCents`, `status`) is defined in Task 5's view with exactly those names and `::int`-cast types. Written together, not left for a task reviewer to discover a typo. |
| Task 9 `BillingController`'s route paths vs Task 11's web `api.ts` | Both written from the same list in the design doc (§3.1–3.6) in the same authoring pass — 10 routes, one list, transcribed twice without redriving it. |
| Task 6's `generateCharges` `GenerateChargesResult` shape vs Task 9's controller response | `{ toCreate: Array<{ clientId, clientName, planId, periodLabel, amountCents, dueOn }> }` — `clientName` added at the controller's response-mapping step (`toResponse`-equivalent), same pattern Phase 2 used for `ObligationWithDefinition`'s `clientName`, not invented fresh here. |
| Task 12 (home page) vs Task 15 (`ClientLedgerSection`) | Both consume `getReceivables`/`getClientLedger` from Task 11's `api.ts` with matching TypeScript return types — checked field-for-field against Task 8's service return types before either web task was written, so a web task's assumption about a field name can't drift from what the service actually returns. |
| Task 13/14's retainer-plan forms vs Task 6's service | `renewRetainerPlan`'s body `{ newAmountCents, effectiveFrom, periodicity?, dueDayOfMonth? }` (optional overrides default to the current plan's own values) — the web form (Task 14) never needs to resend `periodicity`/`dueDayOfMonth` for a pure fee change, only for a `periodicity` change alongside it. Confirmed the two optional fields are genuinely optional on both ends, not silently required by one side. |
| Phase 2 symbols this plan assumes exist | Verified via grep against the actual repo during authoring: `ClientsService.findOne`, `PrismaService`, `ZodValidationPipe`'s message→code promotion, `SessionGuard`, `isoDateSchema`/`uuidSchema` (`packages/domain/src/schemas/common.ts`), `AppError(code, params, status)`, `apps/web/src/shell/ErrorMessage.tsx`, `apps/web/src/clients/ClientDetailPage.tsx`'s current section order (`FiscalProfileForm` → `ObligationsSection` → `EmploymentSection` → `CredentialsSection`), `apps/web/src/router.tsx`'s `indexRoute` currently pointing straight at `ObligationsDashboard`, `apps/web/src/obligations/ObligationsDashboard.tsx`'s self-contained `<section>` markup (no changes needed to it — Task 12 wraps it, doesn't touch it), `btree_gist` already enabled (`20260908141839_init/migration.sql`), and the exact `EXCLUDE USING gist` syntax `Employment` already uses (reused for `RetainerPlan`'s own non-overlap constraint in Task 5).

Scan clean. Proceeding to Task 1.

---

### Task 1: Domain enums and error codes

**Files:**
- Modify: `packages/domain/src/enums.ts`
- Modify: `packages/domain/src/errors.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (consumed by every later task in this plan):
  - `CHARGE_KIND_VALUES: readonly ['RETAINER', 'EXTRA']`, `type ChargeKind`
  - `PAYMENT_METHOD_VALUES: readonly ['TRANSFER', 'CASH', 'DIRECT_DEBIT', 'OTHER']`, `type PaymentMethod`
  - `CHARGE_STATUS_VALUES: readonly ['OPEN', 'PARTIAL', 'SETTLED', 'WRITTEN_OFF']`, `type ChargeStatus`
  - New `ErrorCode` members: `'billing.write_off_reason_required'`, `'billing.allocation_exceeds_payment'`, `'billing.allocation_exceeds_charge_balance'`, `'billing.plan_overlap'`

- [ ] **Step 1: Write the enum test**

`packages/domain/src/enums.test.ts` already exists from Phase 0/1/2 — find it with `grep -rn "AUTHORITY_VALUES" packages/domain/src/enums.test.ts` to see the existing style, then add:

```ts
import { CHARGE_KIND_VALUES, CHARGE_STATUS_VALUES, PAYMENT_METHOD_VALUES } from './enums'

describe('billing enums', () => {
  it('CHARGE_KIND_VALUES has the two charge kinds', () => {
    expect(CHARGE_KIND_VALUES).toEqual(['RETAINER', 'EXTRA'])
  })

  it('PAYMENT_METHOD_VALUES has the four payment methods', () => {
    expect(PAYMENT_METHOD_VALUES).toEqual(['TRANSFER', 'CASH', 'DIRECT_DEBIT', 'OTHER'])
  })

  it('CHARGE_STATUS_VALUES has the four derived statuses', () => {
    expect(CHARGE_STATUS_VALUES).toEqual(['OPEN', 'PARTIAL', 'SETTLED', 'WRITTEN_OFF'])
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/domain test -- enums`
Expected: FAIL — the three new exports don't exist yet.

- [ ] **Step 3: Add the enums**

Append to `packages/domain/src/enums.ts` (after `DEFINITION_SOURCE_VALUES`, the last entry Phase 2 added):

```ts
export const CHARGE_KIND_VALUES = ['RETAINER', 'EXTRA'] as const
export type ChargeKind = (typeof CHARGE_KIND_VALUES)[number]

export const PAYMENT_METHOD_VALUES = ['TRANSFER', 'CASH', 'DIRECT_DEBIT', 'OTHER'] as const
export type PaymentMethod = (typeof PAYMENT_METHOD_VALUES)[number]

// Derived, never stored (master spec §8.3) — a charge has no status column.
// Exists as an enum purely so the web layer has one shared type for it.
export const CHARGE_STATUS_VALUES = ['OPEN', 'PARTIAL', 'SETTLED', 'WRITTEN_OFF'] as const
export type ChargeStatus = (typeof CHARGE_STATUS_VALUES)[number]
```

- [ ] **Step 4: Add the error codes**

In `packages/domain/src/errors.ts`, add four entries to `ERROR_CODES` right after `'obligations.definition_code_taken'`:

```ts
  'billing.write_off_reason_required',
  'billing.allocation_exceeds_payment',
  'billing.allocation_exceeds_charge_balance',
  'billing.plan_overlap',
```

- [ ] **Step 5: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/domain test -- enums`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/domain typecheck && pnpm --filter @ledger-hq/domain lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/enums.ts packages/domain/src/enums.test.ts packages/domain/src/errors.ts
git commit -m "feat(domain): add billing enums and error codes"
```

---

### Task 2: Charge period and due-date helpers

**Files:**
- Create: `packages/domain/src/billing/periods.ts`
- Create: `packages/domain/src/billing/periods.test.ts`

**Interfaces:**
- Consumes: `Periodicity` (`@ledger-hq/domain`, Task 1's package — already exists from Phase 2's Task 1).
- Produces (consumed by Task 6's generator):
  - `type ChargePeriod = { start: Date; label: string }`
  - `chargePeriodsSince(periodicity: Periodicity, validFrom: Date, asOf: Date): ChargePeriod[]`
  - `chargeDueDate(periodStart: Date, dueDayOfMonth: number): Date`

Not a reuse of the obligation resolver's `generatePeriods` (Phase 2, Task 3). That function's contract is "give me every period whose window overlaps `[from, to]`," tuned for obligations proposing periods up to 12 months ahead of `asOf`. Billing's rule is different and simpler: "a charge is born when its period begins, and never before" (master spec §8.1) — there is no future horizon at all, only "every period whose start has already happened by `asOf`." Stretching `generatePeriods` to express "no horizon" would mean passing `to = asOf` and then separately re-checking `period.start <= asOf` to guard against a resolver that (correctly, for obligations) includes a period already in progress at `to`. Two purpose-built functions, each with an obvious job, are clearer than one repurposed one.

- [ ] **Step 1: Write the period tests**

`packages/domain/src/billing/periods.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { chargeDueDate, chargePeriodsSince } from './periods'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

describe('chargePeriodsSince', () => {
  it('MONTHLY: one period per elapsed month, none in the future', () => {
    const periods = chargePeriodsSince('MONTHLY', utc(2026, 1, 1), utc(2026, 3, 18))
    expect(periods.map((p) => p.label)).toEqual(['2026-01', '2026-02', '2026-03'])
    // March's period starts 1 March, before asOf's 18 March — it has begun,
    // so it's included even though the month itself isn't over.
    expect(periods[2]!.start).toEqual(utc(2026, 3, 1))
  })

  it('MONTHLY: a plan starting mid-month begins counting from that month', () => {
    const periods = chargePeriodsSince('MONTHLY', utc(2026, 2, 15), utc(2026, 4, 1))
    expect(periods.map((p) => p.label)).toEqual(['2026-02', '2026-03', '2026-04'])
  })

  it('QUARTERLY: labels and quarter boundaries', () => {
    const periods = chargePeriodsSince('QUARTERLY', utc(2026, 1, 1), utc(2026, 8, 1))
    expect(periods.map((p) => p.label)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3'])
    expect(periods[1]!.start).toEqual(utc(2026, 4, 1))
  })

  it('ANNUAL: one period per elapsed year', () => {
    const periods = chargePeriodsSince('ANNUAL', utc(2024, 6, 1), utc(2026, 1, 1))
    // A plan starting mid-2024 has its first annual period begin at the
    // start of the quarter/month it was created in for MONTHLY/QUARTERLY,
    // but ANNUAL periods align to calendar years regardless of validFrom's
    // month — the plan's first full or partial year is still "2024".
    expect(periods.map((p) => p.label)).toEqual(['2024', '2025', '2026'])
  })

  it('excludes a period that has not started yet', () => {
    const periods = chargePeriodsSince('MONTHLY', utc(2026, 1, 1), utc(2026, 1, 31))
    expect(periods.map((p) => p.label)).toEqual(['2026-01'])
  })

  it('returns nothing when validFrom is after asOf', () => {
    const periods = chargePeriodsSince('MONTHLY', utc(2026, 5, 1), utc(2026, 3, 1))
    expect(periods).toEqual([])
  })
})

describe('chargeDueDate', () => {
  it('places the due date on the given day of the period start month', () => {
    expect(chargeDueDate(utc(2026, 3, 1), 8)).toEqual(utc(2026, 3, 8))
  })

  it('clamps to the last day of a short month', () => {
    // February 2026 (not a leap year) has 28 days.
    expect(chargeDueDate(utc(2026, 2, 1), 30)).toEqual(utc(2026, 2, 28))
  })

  it('clamps correctly in a leap February', () => {
    expect(chargeDueDate(utc(2028, 2, 1), 30)).toEqual(utc(2028, 2, 29))
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/domain test -- billing/periods`
Expected: FAIL — `./periods` does not exist.

- [ ] **Step 3: Implement the period helpers**

`packages/domain/src/billing/periods.ts`:

```ts
import type { Periodicity } from '../enums'

export type ChargePeriod = { start: Date; label: string }

function monthsPerStep(periodicity: Periodicity): number {
  if (periodicity === 'MONTHLY') return 1
  if (periodicity === 'QUARTERLY') return 3
  return 12
}

function alignedStartMonthIndex(periodicity: Periodicity, monthIndex: number): number {
  if (periodicity === 'QUARTERLY') return Math.floor(monthIndex / 3) * 3
  if (periodicity === 'ANNUAL') return 0
  return monthIndex
}

function labelFor(periodicity: Periodicity, cursor: Date): string {
  const year = cursor.getUTCFullYear()
  const month = cursor.getUTCMonth()
  if (periodicity === 'MONTHLY') return `${year}-${String(month + 1).padStart(2, '0')}`
  if (periodicity === 'QUARTERLY') return `${year}-Q${Math.floor(month / 3) + 1}`
  return `${year}`
}

/**
 * Every period whose start has already happened by `asOf`, starting from
 * the period containing `validFrom`. No future horizon — unlike the
 * obligation resolver's `generatePeriods`, this never looks ahead, matching
 * "a charge is born when its period begins" (master spec §8.1).
 */
export function chargePeriodsSince(periodicity: Periodicity, validFrom: Date, asOf: Date): ChargePeriod[] {
  const step = monthsPerStep(periodicity)
  const startMonthIndex = alignedStartMonthIndex(periodicity, validFrom.getUTCMonth())
  let cursor = new Date(Date.UTC(validFrom.getUTCFullYear(), startMonthIndex, 1))

  const periods: ChargePeriod[] = []
  while (cursor <= asOf) {
    periods.push({ start: cursor, label: labelFor(periodicity, cursor) })
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + step, 1))
  }
  return periods
}

/**
 * `dueDayOfMonth` within `periodStart`'s month, clamped to that month's
 * last day for short months (master spec §8.1). Uses the same "day 0 of
 * next month" idiom as the obligation resolver's `lastDayOfMonthsAfter`.
 */
export function chargeDueDate(periodStart: Date, dueDayOfMonth: number): Date {
  const lastDayOfMonth = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0)).getUTCDate()
  const day = Math.min(dueDayOfMonth, lastDayOfMonth)
  return new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), day))
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/domain test -- billing/periods`
Expected: PASS, all cases green.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/domain typecheck && pnpm --filter @ledger-hq/domain lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/billing/periods.ts packages/domain/src/billing/periods.test.ts
git commit -m "feat(domain): add charge period and due-date helpers"
```

---

### Task 3: The pure allocation function

**Files:**
- Create: `packages/domain/src/billing/types.ts`
- Create: `packages/domain/src/billing/allocate.ts`
- Create: `packages/domain/src/billing/allocate.test.ts`

**Interfaces:**
- Consumes: `ChargeKind`, `ChargeStatus` (`@ledger-hq/domain`, Task 1).
- Produces (consumed by Task 7's `proposeAllocationForClient` and Task 8's SQL row type):
  - `type ChargeBalance = { id: string; clientId: string; kind: ChargeKind; periodLabel: string | null; dueOn: string; amountCents: number; allocatedCents: number; outstandingCents: number; status: ChargeStatus }`
  - `type ProposedAllocation = { chargeId: string; amountCents: number }`
  - `proposeAllocation(paymentAmountCents: number, openCharges: ChargeBalance[]): ProposedAllocation[]`

`dueOn` is a `string` (`YYYY-MM-DD`), not a `Date` — `ChargeBalance` is the shape of a row read back from the `charge_balances` SQL view (Task 5/8), and Prisma's raw-query results serialize `date` columns as ISO strings, not `Date` instances, the same convention `ObligationResponse` already uses on the web side for the same reason.

- [ ] **Step 1: Write the allocation tests**

`packages/domain/src/billing/allocate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { proposeAllocation } from './allocate'
import type { ChargeBalance } from './types'

function openCharge(overrides: Partial<ChargeBalance> & { id: string; dueOn: string; outstandingCents: number }): ChargeBalance {
  return {
    clientId: 'c1',
    kind: 'RETAINER',
    periodLabel: null,
    amountCents: overrides.outstandingCents,
    allocatedCents: 0,
    status: 'OPEN',
    ...overrides,
  }
}

describe('proposeAllocation', () => {
  it('allocates a payment that exactly covers one open charge', () => {
    const charges = [openCharge({ id: 'a', dueOn: '2026-01-01', outstandingCents: 9000 })]
    expect(proposeAllocation(9000, charges)).toEqual([{ chargeId: 'a', amountCents: 9000 }])
  })

  it('allocates FIFO across several charges, oldest due date first', () => {
    const charges = [
      openCharge({ id: 'march', dueOn: '2026-03-08', outstandingCents: 9000 }),
      openCharge({ id: 'january', dueOn: '2026-01-08', outstandingCents: 9000 }),
      openCharge({ id: 'february', dueOn: '2026-02-08', outstandingCents: 9000 }),
    ]
    // 360 EUR against four 90 EUR months — the master spec's own example
    // (§8.2) — but this test has only 3 charges totalling 270; the payment
    // fully covers all three in due-date order regardless of input order.
    expect(proposeAllocation(27000, charges)).toEqual([
      { chargeId: 'january', amountCents: 9000 },
      { chargeId: 'february', amountCents: 9000 },
      { chargeId: 'march', amountCents: 9000 },
    ])
  })

  it('partially allocates the last charge the payment reaches, and stops', () => {
    const charges = [
      openCharge({ id: 'january', dueOn: '2026-01-08', outstandingCents: 9000 }),
      openCharge({ id: 'february', dueOn: '2026-02-08', outstandingCents: 9000 }),
    ]
    expect(proposeAllocation(12000, charges)).toEqual([
      { chargeId: 'january', amountCents: 9000 },
      { chargeId: 'february', amountCents: 3000 },
    ])
  })

  it('allocates against a partially-paid charge using only its remaining outstanding balance', () => {
    const charges = [openCharge({ id: 'a', dueOn: '2026-01-08', outstandingCents: 3000, allocatedCents: 6000, amountCents: 9000 })]
    expect(proposeAllocation(9000, charges)).toEqual([{ chargeId: 'a', amountCents: 3000 }])
  })

  it('never allocates more than the payment, leaving the rest unallocated as excess', () => {
    const charges = [openCharge({ id: 'a', dueOn: '2026-01-08', outstandingCents: 5000 })]
    const result = proposeAllocation(30000, charges)
    expect(result).toEqual([{ chargeId: 'a', amountCents: 5000 }])
    const totalAllocated = result.reduce((sum, allocation) => sum + allocation.amountCents, 0)
    expect(totalAllocated).toBeLessThanOrEqual(30000)
  })

  it('ignores a charge with zero outstanding balance', () => {
    const charges = [
      openCharge({ id: 'settled', dueOn: '2026-01-08', outstandingCents: 0, allocatedCents: 9000, amountCents: 9000, status: 'SETTLED' }),
      openCharge({ id: 'open', dueOn: '2026-02-08', outstandingCents: 9000 }),
    ]
    expect(proposeAllocation(9000, charges)).toEqual([{ chargeId: 'open', amountCents: 9000 }])
  })

  it('returns an empty array when there are no open charges', () => {
    expect(proposeAllocation(9000, [])).toEqual([])
  })

  it('returns an empty array when the payment is zero', () => {
    const charges = [openCharge({ id: 'a', dueOn: '2026-01-08', outstandingCents: 9000 })]
    expect(proposeAllocation(0, charges)).toEqual([])
  })

  it('property: never allocates more than each charge\'s own outstanding balance', () => {
    const charges = [
      openCharge({ id: 'a', dueOn: '2026-01-08', outstandingCents: 1500 }),
      openCharge({ id: 'b', dueOn: '2026-02-08', outstandingCents: 4000 }),
    ]
    for (const allocation of proposeAllocation(999999, charges)) {
      const charge = charges.find((c) => c.id === allocation.chargeId)!
      expect(allocation.amountCents).toBeLessThanOrEqual(charge.outstandingCents)
    }
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/domain test -- billing/allocate`
Expected: FAIL — neither `./types` nor `./allocate` exist.

- [ ] **Step 3: Implement the types and the allocator**

`packages/domain/src/billing/types.ts`:

```ts
import type { ChargeKind, ChargeStatus } from '../enums'

/** A row of the `charge_balances` database view (master spec §8.3). */
export type ChargeBalance = {
  id: string
  clientId: string
  kind: ChargeKind
  periodLabel: string | null
  dueOn: string
  amountCents: number
  allocatedCents: number
  outstandingCents: number
  status: ChargeStatus
}

export type ProposedAllocation = { chargeId: string; amountCents: number }
```

`packages/domain/src/billing/allocate.ts`:

```ts
import type { ChargeBalance, ProposedAllocation } from './types'

/**
 * FIFO allocation of a payment across a client's open charges, oldest due
 * date first, until the payment is exhausted (master spec §8.2). Never
 * mutates its input; never allocates more than a charge's own outstanding
 * balance or more than the payment amount in total. The caller — never this
 * function — decides whether to apply the proposal as-is or let the
 * accountant redistribute it first.
 */
export function proposeAllocation(paymentAmountCents: number, openCharges: ChargeBalance[]): ProposedAllocation[] {
  const sorted = [...openCharges].filter((charge) => charge.outstandingCents > 0).sort((a, b) => a.dueOn.localeCompare(b.dueOn))

  const allocations: ProposedAllocation[] = []
  let remaining = paymentAmountCents

  for (const charge of sorted) {
    if (remaining <= 0) break
    const amount = Math.min(remaining, charge.outstandingCents)
    allocations.push({ chargeId: charge.id, amountCents: amount })
    remaining -= amount
  }

  return allocations
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/domain test -- billing/allocate`
Expected: PASS, all cases green.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/domain typecheck && pnpm --filter @ledger-hq/domain lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/billing/types.ts packages/domain/src/billing/allocate.ts packages/domain/src/billing/allocate.test.ts
git commit -m "feat(domain): add the pure FIFO payment-allocation function"
```

---

### Task 4: Domain request/response schemas

**Files:**
- Create: `packages/domain/src/schemas/billing.ts`
- Create: `packages/domain/src/schemas/billing.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `isoDateSchema`, `uuidSchema` (`./common`); `PERIODICITY_VALUES`, `PAYMENT_METHOD_VALUES` (`../enums`).
- Produces (consumed by Task 9's controller and Task 11's web `api.ts`):
  - `generateChargesQuerySchema` / `GenerateChargesQuery`
  - `generateChargesBodySchema` / `GenerateChargesInput`
  - `createRetainerPlanSchema` / `CreateRetainerPlanInput`
  - `renewRetainerPlanSchema` / `RenewRetainerPlanInput`
  - `proposeAllocationSchema` / `ProposeAllocationInput`
  - `recordPaymentSchema` / `RecordPaymentInput`
  - `createAdHocChargeSchema` / `CreateAdHocChargeInput`
  - `writeOffChargeSchema` / `WriteOffChargeInput`

- [ ] **Step 1: Write the schema tests**

`packages/domain/src/schemas/billing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  createAdHocChargeSchema,
  createRetainerPlanSchema,
  generateChargesBodySchema,
  generateChargesQuerySchema,
  proposeAllocationSchema,
  recordPaymentSchema,
  renewRetainerPlanSchema,
  writeOffChargeSchema,
} from './billing'

describe('generateChargesQuerySchema', () => {
  it('accepts dryRun as "true" or "false"', () => {
    expect(generateChargesQuerySchema.safeParse({ dryRun: 'true' }).success).toBe(true)
    expect(generateChargesQuerySchema.safeParse({ dryRun: 'false' }).success).toBe(true)
  })

  it('accepts an omitted dryRun', () => {
    expect(generateChargesQuerySchema.safeParse({}).success).toBe(true)
  })

  it('rejects any other value', () => {
    expect(generateChargesQuerySchema.safeParse({ dryRun: 'yes' }).success).toBe(false)
  })
})

describe('generateChargesBodySchema', () => {
  it('accepts an empty body — sweeps every client as of now', () => {
    expect(generateChargesBodySchema.safeParse({}).success).toBe(true)
  })

  it('accepts an explicit asOf and clientId', () => {
    const result = generateChargesBodySchema.safeParse({ asOf: '2026-03-18', clientId: '11111111-1111-1111-1111-111111111111' })
    expect(result.success).toBe(true)
  })
})

describe('createRetainerPlanSchema', () => {
  it('accepts a valid plan', () => {
    const result = createRetainerPlanSchema.safeParse({
      amountCents: 9000,
      periodicity: 'MONTHLY',
      dueDayOfMonth: 8,
      validFrom: '2026-01-01',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a dueDayOfMonth above 28', () => {
    const result = createRetainerPlanSchema.safeParse({
      amountCents: 9000,
      periodicity: 'MONTHLY',
      dueDayOfMonth: 29,
      validFrom: '2026-01-01',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-positive amount', () => {
    const result = createRetainerPlanSchema.safeParse({
      amountCents: 0,
      periodicity: 'MONTHLY',
      dueDayOfMonth: 8,
      validFrom: '2026-01-01',
    })
    expect(result.success).toBe(false)
  })
})

describe('renewRetainerPlanSchema', () => {
  it('accepts just the required fields, periodicity/dueDayOfMonth optional', () => {
    const result = renewRetainerPlanSchema.safeParse({ newAmountCents: 12000, effectiveFrom: '2026-06-01' })
    expect(result.success).toBe(true)
  })
})

describe('proposeAllocationSchema', () => {
  it('accepts a valid proposal request', () => {
    const result = proposeAllocationSchema.safeParse({
      clientId: '11111111-1111-1111-1111-111111111111',
      amountCents: 36000,
    })
    expect(result.success).toBe(true)
  })
})

describe('recordPaymentSchema', () => {
  it('accepts a valid payment with allocations', () => {
    const result = recordPaymentSchema.safeParse({
      clientId: '11111111-1111-1111-1111-111111111111',
      amountCents: 36000,
      receivedOn: '2026-09-03',
      method: 'TRANSFER',
      allocations: [{ chargeId: '22222222-2222-2222-2222-222222222222', amountCents: 9000 }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts an empty allocations array — a payment recorded as pure credit', () => {
    const result = recordPaymentSchema.safeParse({
      clientId: '11111111-1111-1111-1111-111111111111',
      amountCents: 36000,
      receivedOn: '2026-09-03',
      method: 'TRANSFER',
      allocations: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid method', () => {
    const result = recordPaymentSchema.safeParse({
      clientId: '11111111-1111-1111-1111-111111111111',
      amountCents: 36000,
      receivedOn: '2026-09-03',
      method: 'BITCOIN',
      allocations: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('createAdHocChargeSchema', () => {
  it('accepts a valid ad-hoc charge', () => {
    const result = createAdHocChargeSchema.safeParse({
      clientId: '11111111-1111-1111-1111-111111111111',
      description: 'Consultoria extra',
      amountCents: 15000,
      dueOn: '2026-10-01',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an empty description', () => {
    const result = createAdHocChargeSchema.safeParse({
      clientId: '11111111-1111-1111-1111-111111111111',
      description: '',
      amountCents: 15000,
      dueOn: '2026-10-01',
    })
    expect(result.success).toBe(false)
  })
})

describe('writeOffChargeSchema', () => {
  it('accepts a non-empty reason', () => {
    expect(writeOffChargeSchema.safeParse({ reason: 'Cliente insolvente' }).success).toBe(true)
  })

  it('rejects an empty or whitespace-only reason with the billing error code', () => {
    const result = writeOffChargeSchema.safeParse({ reason: '   ' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('billing.write_off_reason_required')
    }
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/domain test -- schemas/billing`
Expected: FAIL — `./billing` does not exist.

- [ ] **Step 3: Implement the schemas**

`packages/domain/src/schemas/billing.ts`:

```ts
import { z } from 'zod'
import { PAYMENT_METHOD_VALUES, PERIODICITY_VALUES } from '../enums'
import { isoDateSchema, uuidSchema } from './common'

export const generateChargesQuerySchema = z
  .object({ dryRun: z.enum(['true', 'false']).optional() })
  .strict()

export type GenerateChargesQuery = z.infer<typeof generateChargesQuerySchema>

export const generateChargesBodySchema = z
  .object({
    asOf: isoDateSchema.optional(),
    clientId: uuidSchema.optional(),
  })
  .strict()

export type GenerateChargesInput = z.infer<typeof generateChargesBodySchema>

export const createRetainerPlanSchema = z
  .object({
    amountCents: z.number().int().positive(),
    periodicity: z.enum(PERIODICITY_VALUES),
    dueDayOfMonth: z.number().int().min(1).max(28),
    validFrom: isoDateSchema,
  })
  .strict()

export type CreateRetainerPlanInput = z.infer<typeof createRetainerPlanSchema>

export const renewRetainerPlanSchema = z
  .object({
    newAmountCents: z.number().int().positive(),
    effectiveFrom: isoDateSchema,
    periodicity: z.enum(PERIODICITY_VALUES).optional(),
    dueDayOfMonth: z.number().int().min(1).max(28).optional(),
  })
  .strict()

export type RenewRetainerPlanInput = z.infer<typeof renewRetainerPlanSchema>

export const proposeAllocationSchema = z
  .object({
    clientId: uuidSchema,
    amountCents: z.number().int().positive(),
  })
  .strict()

export type ProposeAllocationInput = z.infer<typeof proposeAllocationSchema>

export const recordPaymentSchema = z
  .object({
    clientId: uuidSchema,
    amountCents: z.number().int().positive(),
    receivedOn: isoDateSchema,
    method: z.enum(PAYMENT_METHOD_VALUES),
    reference: z.string().trim().max(200).optional(),
    allocations: z.array(
      z.object({
        chargeId: uuidSchema,
        amountCents: z.number().int().positive(),
      }),
    ),
  })
  .strict()

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>

export const createAdHocChargeSchema = z
  .object({
    clientId: uuidSchema,
    description: z.string().trim().min(1).max(200),
    amountCents: z.number().int().positive(),
    dueOn: isoDateSchema,
  })
  .strict()

export type CreateAdHocChargeInput = z.infer<typeof createAdHocChargeSchema>

export const writeOffChargeSchema = z
  .object({ reason: z.string() })
  .strict()
  .refine((value) => value.reason.trim().length > 0, {
    message: 'billing.write_off_reason_required',
    path: ['reason'],
  })

export type WriteOffChargeInput = z.infer<typeof writeOffChargeSchema>
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/domain test -- schemas/billing`
Expected: PASS, all cases green.

- [ ] **Step 5: Export from the package barrel**

Add to `packages/domain/src/index.ts`, after `export * from './schemas/obligation'`:

```ts
export * from './schemas/billing'
```

And after `export * from './obligations/group-by-urgency'`:

```ts
export * from './billing/types'
export * from './billing/allocate'
export * from './billing/periods'
```

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/domain typecheck && pnpm --filter @ledger-hq/domain lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/schemas/billing.ts packages/domain/src/schemas/billing.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): add billing request/response schemas"
```

---

### Task 5: Database schema, migration, and the `charge_balances` view

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_billing/migration.sql` (generated, then hand-extended)
- Modify: `apps/api/test/database.ts`
- Modify: `apps/api/test/schema-constraints.integration.test.ts`

**Interfaces:**
- Consumes: `Periodicity`, `ChargeKind`, `PaymentMethod` (`@ledger-hq/domain`, Tasks 1 and Phase 2's Task 1 — enum member names must match exactly).
- Produces (consumed by every later backend task):
  - Prisma models `RetainerPlan`, `Charge`, `Payment`, `PaymentAllocation`.
  - A `charge_balances` SQL view — not a Prisma model, queried through `prisma.$queryRaw` (Prisma has no first-class "database view" authoring in `schema.prisma`; modeling it as an unmanaged raw view and reading it with `$queryRaw` avoids fighting the ORM for something this small).
  - New `Client` relations: `retainerPlans RetainerPlan[]`, `charges Charge[]`, `payments Payment[]`.

A local Postgres must be reachable (`docker compose up -d` from the repo root — only the `postgres` service is needed, not `api`/`web`; those run production images and aren't used for this workflow). `btree_gist` is already enabled (`20260908141839_init/migration.sql`, for `Employment`'s own overlap constraint) — this task's migration does not need `CREATE EXTENSION` again, though adding `CREATE EXTENSION IF NOT EXISTS btree_gist;` defensively is harmless if `prisma migrate dev --create-only`'s scaffold happens to omit it.

- [ ] **Step 1: Extend the schema**

Add to `apps/api/prisma/schema.prisma`, after the `DefinitionSource` enum (Phase 2's last addition):

```prisma
enum ChargeKind {
  RETAINER
  EXTRA
}

enum PaymentMethod {
  TRANSFER
  CASH
  DIRECT_DEBIT
  OTHER
}
```

Add three new relations to the existing `Client` model, alongside `obligations`:

```prisma
  retainerPlans RetainerPlan[]
  charges       Charge[]
  payments      Payment[]
```

Add four new models, after `ObligationInstance`:

```prisma
model RetainerPlan {
  id            String      @id @db.Uuid
  clientId      String      @db.Uuid
  amountCents   Int
  periodicity   Periodicity
  dueDayOfMonth Int
  validFrom     DateTime    @db.Date
  validTo       DateTime?   @db.Date

  client  Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  charges Charge[]

  @@index([clientId])
}

model Charge {
  id             String        @id @db.Uuid
  clientId       String        @db.Uuid
  kind           ChargeKind
  description    String
  periodLabel    String?
  amountCents    Int
  issuedOn       DateTime      @db.Date
  dueOn          DateTime      @db.Date
  planId         String?       @db.Uuid
  writtenOffAt   DateTime?     @db.Timestamptz(3)
  writeOffReason String?
  createdAt      DateTime      @default(now()) @db.Timestamptz(3)
  updatedAt      DateTime      @updatedAt @db.Timestamptz(3)

  client      Client              @relation(fields: [clientId], references: [id], onDelete: Cascade)
  plan        RetainerPlan?       @relation(fields: [planId], references: [id], onDelete: SetNull)
  allocations PaymentAllocation[]

  // planId is null for every EXTRA charge, and Postgres treats each NULL as
  // distinct for uniqueness purposes — this constraint only ever fires for
  // RETAINER charges, exactly as intended (master spec §8.1).
  @@unique([clientId, planId, periodLabel])
  @@index([clientId])
  @@index([dueOn])
}

model Payment {
  id          String        @id @db.Uuid
  clientId    String        @db.Uuid
  amountCents Int
  receivedOn  DateTime      @db.Date
  method      PaymentMethod
  reference   String?
  createdAt   DateTime      @default(now()) @db.Timestamptz(3)

  client      Client              @relation(fields: [clientId], references: [id], onDelete: Cascade)
  allocations PaymentAllocation[]

  @@index([clientId])
}

model PaymentAllocation {
  paymentId   String @db.Uuid
  chargeId    String @db.Uuid
  amountCents Int

  payment Payment @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  charge  Charge  @relation(fields: [chargeId], references: [id], onDelete: Cascade)

  @@id([paymentId, chargeId])
}
```

- [ ] **Step 2: Generate the migration without applying it**

```bash
cd apps/api
pnpm exec prisma migrate dev --name billing --create-only
```

Expected: a new `prisma/migrations/<timestamp>_billing/migration.sql` containing the two enums, the four tables, their foreign keys, and the two indexes/unique constraint above — nothing else yet. `--create-only` stops here deliberately, because the next step hand-appends SQL Prisma cannot express from `schema.prisma` alone.

- [ ] **Step 3: Hand-append the exclusion constraint and the view**

Open the generated `migration.sql` and append at the end:

```sql
-- Equality operators on uuid inside a GiST exclusion constraint (already
-- enabled by Employment's own migration; safe to repeat).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- No two overlapping in-force plans for the same client — a null validTo
-- (currently in force) is treated as an unbounded upper range, so a client
-- can never have two "currently in force" plans nor two plans whose date
-- ranges intersect. Same idiom as Employment's own non-overlap constraint
-- (20260908141839_init/migration.sql).
ALTER TABLE "RetainerPlan" ADD CONSTRAINT "retainer_plan_no_overlap" EXCLUDE USING gist (
  "clientId" WITH =,
  daterange("validFrom", "validTo", '[]') WITH &&
);

ALTER TABLE "RetainerPlan" ADD CONSTRAINT "retainer_plan_due_day_range" CHECK ("dueDayOfMonth" BETWEEN 1 AND 28);

-- Derives status and outstanding balance instead of storing either (master
-- spec §8.3) — a charge is settled because its allocations sum to its
-- amount, not because a column says so and might drift. SUM()/COUNT() over
-- an Int column returns bigint in Postgres; every aggregate here is cast
-- ::int explicitly so every consumer (Task 8's raw queries) gets a plain
-- JSON-serializable number, never a JS bigint.
CREATE VIEW charge_balances AS
SELECT
  c.id,
  c."clientId",
  c.kind,
  c."periodLabel",
  c."dueOn",
  c."amountCents",
  COALESCE(SUM(a."amountCents"), 0)::int AS "allocatedCents",
  (c."amountCents" - COALESCE(SUM(a."amountCents"), 0))::int AS "outstandingCents",
  CASE
    WHEN c."writtenOffAt" IS NOT NULL THEN 'WRITTEN_OFF'
    WHEN COALESCE(SUM(a."amountCents"), 0) >= c."amountCents" THEN 'SETTLED'
    WHEN COALESCE(SUM(a."amountCents"), 0) > 0 THEN 'PARTIAL'
    ELSE 'OPEN'
  END AS status
FROM "Charge" c
LEFT JOIN "PaymentAllocation" a ON a."chargeId" = c.id
GROUP BY c.id;
```

- [ ] **Step 4: Apply the migration**

```bash
pnpm exec prisma migrate dev
```

Expected: the hand-extended migration applies cleanly (Prisma applies whatever is in the migration file, including the raw SQL just added) and the Prisma Client regenerates. Confirm the client actually regenerated by checking that `src/generated/prisma/models/RetainerPlan.ts`, `Charge.ts`, `Payment.ts`, and `PaymentAllocation.ts` now exist — Phase 2's Task 8 found `migrate dev` doesn't always trigger this reliably; if those files are missing, run `pnpm exec prisma generate` explicitly.

- [ ] **Step 5: Extend the integration test harness's reset order**

`PaymentAllocation` depends on both `Payment` and `Charge`; `Charge` depends on `RetainerPlan` (nullably) and `Client`. Modify `apps/api/test/database.ts`'s `resetDatabase()`, inserting the four new deletes right after `obligationDefinition` and before `credentialVersion`:

```ts
export async function resetDatabase(): Promise<void> {
  const prisma = getTestPrisma()

  await prisma.systemHealth.deleteMany()
  await prisma.obligationInstance.deleteMany()
  await prisma.obligationDefinition.deleteMany()
  await prisma.paymentAllocation.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.charge.deleteMany()
  await prisma.retainerPlan.deleteMany()
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

- [ ] **Step 6: Write constraint tests for the new schema**

Add to `apps/api/test/schema-constraints.integration.test.ts` (mirroring the file's existing style — writing directly through Prisma, bypassing any service layer):

```ts
describe('billing constraints', () => {
  it('rejects two charges with the same client, plan and period label', async () => {
    const prisma = getTestPrisma()
    const client = await prisma.client.create({
      data: { id: uuidv7(), kind: 'COMPANY', name: 'Y', taxId: '500000003', accounting: 'ORGANIZED', legalForm: 'LDA' },
    })
    const plan = await prisma.retainerPlan.create({
      data: { id: uuidv7(), clientId: client.id, amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z') },
    })
    const shared = {
      clientId: client.id,
      kind: 'RETAINER' as const,
      description: 'Retainer',
      periodLabel: '2026-01',
      amountCents: 9000,
      issuedOn: new Date('2026-01-01T00:00:00Z'),
      dueOn: new Date('2026-01-08T00:00:00Z'),
      planId: plan.id,
    }

    await prisma.charge.create({ data: { id: uuidv7(), ...shared } })

    await expect(prisma.charge.create({ data: { id: uuidv7(), ...shared } })).rejects.toThrow()
  })

  it('allows two EXTRA charges with the same client and no period label (planId is null for both)', async () => {
    const prisma = getTestPrisma()
    const client = await prisma.client.create({
      data: { id: uuidv7(), kind: 'COMPANY', name: 'Z', taxId: '500000004', accounting: 'ORGANIZED', legalForm: 'LDA' },
    })
    const shared = {
      clientId: client.id,
      kind: 'EXTRA' as const,
      description: 'Extra work',
      periodLabel: null,
      amountCents: 15000,
      issuedOn: new Date('2026-01-01T00:00:00Z'),
      dueOn: new Date('2026-02-01T00:00:00Z'),
      planId: null,
    }

    await prisma.charge.create({ data: { id: uuidv7(), ...shared } })
    // Must not throw — two EXTRA charges never collide on the unique
    // constraint, since Postgres treats each NULL planId as distinct.
    await expect(prisma.charge.create({ data: { id: uuidv7(), ...shared } })).resolves.toBeDefined()
  })

  it('rejects two overlapping in-force retainer plans for the same client', async () => {
    const prisma = getTestPrisma()
    const client = await prisma.client.create({
      data: { id: uuidv7(), kind: 'COMPANY', name: 'W', taxId: '500000005', accounting: 'ORGANIZED', legalForm: 'LDA' },
    })
    await prisma.retainerPlan.create({
      data: { id: uuidv7(), clientId: client.id, amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z') },
    })

    await expect(
      prisma.retainerPlan.create({
        data: { id: uuidv7(), clientId: client.id, amountCents: 12000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-06-01T00:00:00Z') },
      }),
    ).rejects.toThrow()
  })

  it('the charge_balances view derives status and outstanding balance without a stored column', async () => {
    const prisma = getTestPrisma()
    const client = await prisma.client.create({
      data: { id: uuidv7(), kind: 'COMPANY', name: 'V', taxId: '500000006', accounting: 'ORGANIZED', legalForm: 'LDA' },
    })
    const charge = await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId: client.id,
        kind: 'EXTRA',
        description: 'Test',
        amountCents: 10000,
        issuedOn: new Date('2026-01-01T00:00:00Z'),
        dueOn: new Date('2026-01-08T00:00:00Z'),
      },
    })
    const payment = await prisma.payment.create({
      data: { id: uuidv7(), clientId: client.id, amountCents: 4000, receivedOn: new Date('2026-01-05T00:00:00Z'), method: 'TRANSFER' },
    })
    await prisma.paymentAllocation.create({ data: { paymentId: payment.id, chargeId: charge.id, amountCents: 4000 } })

    const rows = await prisma.$queryRaw<Array<{ outstandingCents: number; status: string }>>`
      SELECT "outstandingCents", status FROM charge_balances WHERE id = ${charge.id}::uuid
    `
    expect(rows).toHaveLength(1)
    expect(typeof rows[0]!.outstandingCents).toBe('number')
    expect(rows[0]!.outstandingCents).toBe(6000)
    expect(rows[0]!.status).toBe('PARTIAL')
  })
})
```

(Confirm the file already imports `uuidv7` and `getTestPrisma` — both are already imported for the pre-existing constraint blocks.)

- [ ] **Step 7: Run the constraint tests**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: PASS, including the 4 new cases.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/database.ts \
  apps/api/test/schema-constraints.integration.test.ts
git commit -m "feat(api): add the billing schema — plans, charges, payments, and the balances view"
```

---

### Task 6: The charge generator and retainer plan lifecycle

**Files:**
- Create: `apps/api/src/billing/billing.service.ts`
- Create: `apps/api/src/billing/billing.service.test.ts`

**Interfaces:**
- Consumes: `chargePeriodsSince`, `chargeDueDate` (`@ledger-hq/domain`, Task 2); `PrismaService`, `ClientsService.findOne` (Phase 0).
- Produces (consumed by Task 7's continuation of this same service, Task 9's controller, and this task's own tests):
  - `BillingService.generateCharges(input: { asOf: Date; clientId?: string }, dryRun: boolean): Promise<GenerateChargesResult>`
  - `GenerateChargesResult = { toCreate: Array<{ clientId: string; planId: string; periodLabel: string; amountCents: number; dueOn: string }> }`
  - `BillingService.createRetainerPlan(clientId: string, input: CreateRetainerPlanInput): Promise<RetainerPlan>`
  - `BillingService.renewRetainerPlan(clientId: string, input: RenewRetainerPlanInput): Promise<{ closedPlanId: string | null; newPlanId: string }>`

Unlike the obligation generator (Phase 2, Task 10), there is no retraction step here at all: a `RetainerPlan` closing (`validTo` set) does not retroactively remove charges already created for periods before that date — those charges are real, already-issued debt, and `chargePeriodsSince`'s own `asOf` bound (Task 2) means a closed plan simply stops producing new periods once `asOf` passes its `validTo`. Nothing to retract.

- [ ] **Step 1: Write the generator and plan-lifecycle tests**

`apps/api/src/billing/billing.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../common/prisma.service.js'
import type { ClientsService } from '../clients/clients.service.js'
import { BillingService } from './billing.service.js'

function fakePrisma(overrides: Record<string, unknown> = {}): PrismaService {
  return {
    client: { findMany: vi.fn().mockResolvedValue([]) },
    retainerPlan: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve(data)),
      update: vi.fn().mockResolvedValue({}),
    },
    charge: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(overrides)),
    ...overrides,
  } as unknown as PrismaService
}

function fakeClientsService(client: unknown): ClientsService {
  return { findOne: vi.fn().mockResolvedValue(client) } as unknown as ClientsService
}

const client = { id: 'c1', kind: 'COMPANY', archivedAt: null }

describe('BillingService#generateCharges', () => {
  it('generates one charge per elapsed period for an in-force plan', async () => {
    const plan = { id: 'plan-1', clientId: 'c1', amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: null }
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      retainerPlan: { findMany: vi.fn().mockResolvedValue([plan]) },
      charge: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
    })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.generateCharges({ asOf: new Date('2026-03-18T00:00:00Z') }, true)

    expect(result.toCreate).toEqual([
      { clientId: 'c1', planId: 'plan-1', periodLabel: '2026-01', amountCents: 9000, dueOn: '2026-01-08' },
      { clientId: 'c1', planId: 'plan-1', periodLabel: '2026-02', amountCents: 9000, dueOn: '2026-02-08' },
      { clientId: 'c1', planId: 'plan-1', periodLabel: '2026-03', amountCents: 9000, dueOn: '2026-03-08' },
    ])
  })

  it('is idempotent: skips a period that already has a charge', async () => {
    const plan = { id: 'plan-1', clientId: 'c1', amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: null }
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      retainerPlan: { findMany: vi.fn().mockResolvedValue([plan]) },
      charge: {
        findMany: vi.fn().mockResolvedValue([{ id: 'existing', clientId: 'c1', planId: 'plan-1', periodLabel: '2026-01' }]),
        create: vi.fn().mockResolvedValue({}),
      },
    })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.generateCharges({ asOf: new Date('2026-02-01T00:00:00Z') }, true)

    expect(result.toCreate).toEqual([
      { clientId: 'c1', planId: 'plan-1', periodLabel: '2026-02', amountCents: 9000, dueOn: '2026-02-08' },
    ])
  })

  it('generates nothing for a client with no in-force plan', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      retainerPlan: { findMany: vi.fn().mockResolvedValue([]) },
    })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.generateCharges({ asOf: new Date('2026-03-18T00:00:00Z') }, true)

    expect(result.toCreate).toEqual([])
  })

  it('dry run never calls charge.create', async () => {
    const plan = { id: 'plan-1', clientId: 'c1', amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: null }
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      retainerPlan: { findMany: vi.fn().mockResolvedValue([plan]) },
    })
    const service = new BillingService(prisma, fakeClientsService(client))

    await service.generateCharges({ asOf: new Date('2026-03-18T00:00:00Z') }, true)

    expect(prisma.charge.create).not.toHaveBeenCalled()
  })

  it('apply (dryRun=false) calls charge.create for every proposed charge', async () => {
    const plan = { id: 'plan-1', clientId: 'c1', amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: null }
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      retainerPlan: { findMany: vi.fn().mockResolvedValue([plan]) },
      charge: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
    })
    const service = new BillingService(prisma, fakeClientsService(client))

    await service.generateCharges({ asOf: new Date('2026-03-18T00:00:00Z') }, false)

    expect(prisma.charge.create).toHaveBeenCalledTimes(3)
  })
})

describe('BillingService#createRetainerPlan', () => {
  it('creates the client\'s first plan', async () => {
    const prisma = fakePrisma()
    const service = new BillingService(prisma, fakeClientsService(client))

    const created = await service.createRetainerPlan('c1', {
      amountCents: 9000,
      periodicity: 'MONTHLY',
      dueDayOfMonth: 8,
      validFrom: '2026-01-01',
    })

    expect(created).toMatchObject({ clientId: 'c1', amountCents: 9000, validTo: null })
  })

  it('rejects a second plan while one is already in force', async () => {
    const prisma = fakePrisma({
      retainerPlan: { findFirst: vi.fn().mockResolvedValue({ id: 'existing' }), create: vi.fn() },
    })
    const service = new BillingService(prisma, fakeClientsService(client))

    await expect(
      service.createRetainerPlan('c1', { amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-01-01' }),
    ).rejects.toThrow('billing.plan_overlap')
  })
})

describe('BillingService#renewRetainerPlan', () => {
  it('closes the current plan and creates a new one in one transaction', async () => {
    const currentPlan = { id: 'old', clientId: 'c1', amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: null }
    const tx = {
      retainerPlan: {
        findFirst: vi.fn().mockResolvedValue(currentPlan),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({ id: 'new' }),
      },
    }
    const prisma = fakePrisma({ $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)) })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.renewRetainerPlan('c1', { newAmountCents: 12000, effectiveFrom: '2026-06-01' })

    expect(result).toEqual({ closedPlanId: 'old', newPlanId: 'new' })
    expect(tx.retainerPlan.update).toHaveBeenCalledWith({
      where: { id: 'old' },
      data: { validTo: new Date('2026-05-31T00:00:00Z') },
    })
    expect(tx.retainerPlan.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ clientId: 'c1', amountCents: 12000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validTo: null }),
    })
  })

  it('creates a plan directly, with no closedPlanId, when the client has no current plan', async () => {
    const tx = {
      retainerPlan: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'new' }),
      },
    }
    const prisma = fakePrisma({ $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)) })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.renewRetainerPlan('c1', { newAmountCents: 9000, effectiveFrom: '2026-01-01', periodicity: 'MONTHLY', dueDayOfMonth: 8 })

    expect(result).toEqual({ closedPlanId: null, newPlanId: 'new' })
    expect(tx.retainerPlan.update).not.toHaveBeenCalled()
  })

  it('rejects a renewal whose effectiveFrom would leave the closed plan with a negative-length range', async () => {
    const currentPlan = { id: 'old', clientId: 'c1', amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-06-01T00:00:00Z'), validTo: null }
    const tx = { retainerPlan: { findFirst: vi.fn().mockResolvedValue(currentPlan), update: vi.fn(), create: vi.fn() } }
    const prisma = fakePrisma({ $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)) })
    const service = new BillingService(prisma, fakeClientsService(client))

    // effectiveFrom before the current plan even started.
    await expect(
      service.renewRetainerPlan('c1', { newAmountCents: 12000, effectiveFrom: '2026-01-01' }),
    ).rejects.toThrow('billing.plan_overlap')
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/api test -- billing.service`
Expected: FAIL — `./billing.service` does not exist.

- [ ] **Step 3: Implement the service**

`apps/api/src/billing/billing.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
import { uuidv7 } from 'uuidv7'
import { AppError, chargeDueDate, chargePeriodsSince } from '@ledger-hq/domain'
import type { CreateRetainerPlanInput, RenewRetainerPlanInput } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ClientsService } from '../clients/clients.service.js'
import type { RetainerPlan } from '../generated/prisma/client.js'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export type GenerateChargesResult = {
  toCreate: Array<{ clientId: string; planId: string; periodLabel: string; amountCents: number; dueOn: string }>
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
  ) {}

  /**
   * For each in-force `RetainerPlan`, creates one `Charge` per period that
   * has already started (master spec §8.1) — unlike the obligation
   * generator, no future horizon, and no retraction: a closed plan simply
   * stops producing new periods once `asOf` moves past its `validTo`.
   */
  async generateCharges(input: { asOf: Date; clientId?: string }, dryRun: boolean): Promise<GenerateChargesResult> {
    const clients = input.clientId
      ? [await this.clients.findOne(input.clientId)]
      : await this.prisma.client.findMany({ where: { archivedAt: null } })

    const toCreate: Array<{ clientId: string; planId: string; period: { start: Date; label: string }; amountCents: number; dueOn: Date }> = []

    for (const client of clients) {
      const plans = await this.prisma.retainerPlan.findMany({
        where: { clientId: client.id, validFrom: { lte: input.asOf }, OR: [{ validTo: null }, { validTo: { gte: input.asOf } }] },
      })

      for (const plan of plans) {
        const periods = chargePeriodsSince(plan.periodicity, plan.validFrom, input.asOf)
        const existing = await this.prisma.charge.findMany({ where: { clientId: client.id, planId: plan.id } })
        const existingLabels = new Set(existing.map((charge) => charge.periodLabel))

        for (const period of periods) {
          if (existingLabels.has(period.label)) continue
          toCreate.push({ clientId: client.id, planId: plan.id, period, amountCents: plan.amountCents, dueOn: chargeDueDate(period.start, plan.dueDayOfMonth) })
        }
      }
    }

    if (!dryRun) {
      for (const item of toCreate) {
        await this.prisma.charge.create({
          data: {
            id: uuidv7(),
            clientId: item.clientId,
            planId: item.planId,
            kind: 'RETAINER',
            description: `Retainer — ${item.period.label}`,
            periodLabel: item.period.label,
            amountCents: item.amountCents,
            issuedOn: item.period.start,
            dueOn: item.dueOn,
          },
        })
      }
    }

    return {
      toCreate: toCreate.map((item) => ({
        clientId: item.clientId,
        planId: item.planId,
        periodLabel: item.period.label,
        amountCents: item.amountCents,
        dueOn: isoDate(item.dueOn),
      })),
    }
  }

  /** Only for a client with no plan at all — see `renewRetainerPlan` for a fee change. */
  async createRetainerPlan(clientId: string, input: CreateRetainerPlanInput): Promise<RetainerPlan> {
    const existing = await this.prisma.retainerPlan.findFirst({ where: { clientId, validTo: null } })
    if (existing) throw new AppError('billing.plan_overlap', {}, 409)

    return this.prisma.retainerPlan.create({
      data: {
        id: uuidv7(),
        clientId,
        amountCents: input.amountCents,
        periodicity: input.periodicity,
        dueDayOfMonth: input.dueDayOfMonth,
        validFrom: new Date(`${input.validFrom}T00:00:00Z`),
        validTo: null,
      },
    })
  }

  /**
   * Closes the currently in-force plan (`validTo = effectiveFrom - 1 day`)
   * and creates its successor, in one transaction — a fee increase must
   * never leave a gap with no plan in force, nor overlap the closed one
   * (master spec §6.6). `periodicity`/`dueDayOfMonth` default to the
   * closed plan's own values when omitted, so a pure fee change never has
   * to resend fields it isn't changing.
   */
  async renewRetainerPlan(clientId: string, input: RenewRetainerPlanInput): Promise<{ closedPlanId: string | null; newPlanId: string }> {
    const effectiveFrom = new Date(`${input.effectiveFrom}T00:00:00Z`)

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.retainerPlan.findFirst({ where: { clientId, validTo: null } })

      if (current) {
        const validTo = new Date(effectiveFrom.getTime() - ONE_DAY_MS)
        if (validTo < current.validFrom) throw new AppError('billing.plan_overlap', {}, 409)
        await tx.retainerPlan.update({ where: { id: current.id }, data: { validTo } })
      }

      const created = await tx.retainerPlan.create({
        data: {
          id: uuidv7(),
          clientId,
          amountCents: input.newAmountCents,
          periodicity: input.periodicity ?? current?.periodicity ?? 'MONTHLY',
          dueDayOfMonth: input.dueDayOfMonth ?? current?.dueDayOfMonth ?? 8,
          validFrom: effectiveFrom,
          validTo: null,
        },
      })

      return { closedPlanId: current?.id ?? null, newPlanId: created.id }
    })
  }
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/api test -- billing.service`
Expected: PASS, all cases green.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/api typecheck && pnpm --filter @ledger-hq/api lint`
Expected: both clean. If typecheck complains that `@ledger-hq/domain` has no exported member for something added in Tasks 1-4, run `pnpm --filter @ledger-hq/domain build` first (Global Constraints).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/billing/billing.service.ts apps/api/src/billing/billing.service.test.ts
git commit -m "feat(api): add the charge generator and retainer plan lifecycle"
```

---

### Task 7: Payment recording, ad-hoc charges, and write-off

**Files:**
- Modify: `apps/api/src/billing/billing.service.ts`
- Modify: `apps/api/src/billing/billing.service.test.ts`

**Interfaces:**
- Consumes: `proposeAllocation`, `ChargeBalance` (`@ledger-hq/domain`, Task 3); `RecordPaymentInput`, `CreateAdHocChargeInput` (`@ledger-hq/domain`, Task 4).
- Produces (consumed by Task 8's continuation, Task 9's controller):
  - `BillingService.proposeAllocationForClient(clientId: string, amountCents: number): Promise<{ proposed: ProposedAllocation[]; excessCents: number }>`
  - `BillingService.recordPayment(input: RecordPaymentInput): Promise<{ paymentId: string }>`
  - `BillingService.createAdHocCharge(input: CreateAdHocChargeInput): Promise<Charge>`
  - `BillingService.writeOffCharge(id: string, reason: string): Promise<Charge>`

`proposeAllocationForClient` reads the client's open charges from `charge_balances` (the view Task 5 created) via `$queryRaw` and hands them straight to Task 3's pure `proposeAllocation` — no allocation logic lives here, only the read and the pure function call.

- [ ] **Step 1: Write the payment/charge/write-off tests**

Append to `apps/api/src/billing/billing.service.test.ts`:

```ts
describe('BillingService#proposeAllocationForClient', () => {
  it('reads open charges from charge_balances and proposes FIFO', async () => {
    const openCharges = [
      { id: 'a', clientId: 'c1', kind: 'RETAINER', periodLabel: '2026-01', dueOn: '2026-01-08', amountCents: 9000, allocatedCents: 0, outstandingCents: 9000, status: 'OPEN' },
    ]
    const prisma = fakePrisma({ $queryRaw: vi.fn().mockResolvedValue(openCharges) })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.proposeAllocationForClient('c1', 9000)

    expect(result).toEqual({ proposed: [{ chargeId: 'a', amountCents: 9000 }], excessCents: 0 })
  })

  it('reports the unallocated remainder as excess', async () => {
    const openCharges = [
      { id: 'a', clientId: 'c1', kind: 'RETAINER', periodLabel: '2026-01', dueOn: '2026-01-08', amountCents: 9000, allocatedCents: 0, outstandingCents: 9000, status: 'OPEN' },
    ]
    const prisma = fakePrisma({ $queryRaw: vi.fn().mockResolvedValue(openCharges) })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.proposeAllocationForClient('c1', 15000)

    expect(result).toEqual({ proposed: [{ chargeId: 'a', amountCents: 9000 }], excessCents: 6000 })
  })
})

describe('BillingService#recordPayment', () => {
  it('creates the payment and every requested allocation in one transaction', async () => {
    const tx = {
      payment: { create: vi.fn().mockResolvedValue({}) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'a', outstandingCents: 9000 }]),
      paymentAllocation: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = fakePrisma({ $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)) })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.recordPayment({
      clientId: 'c1',
      amountCents: 9000,
      receivedOn: '2026-09-03',
      method: 'TRANSFER',
      allocations: [{ chargeId: 'a', amountCents: 9000 }],
    })

    expect(result.paymentId).toEqual(expect.any(String))
    expect(tx.paymentAllocation.create).toHaveBeenCalledTimes(1)
  })

  it('rejects allocations that sum to more than the payment', async () => {
    const prisma = fakePrisma({ $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn({})) })
    const service = new BillingService(prisma, fakeClientsService(client))

    await expect(
      service.recordPayment({
        clientId: 'c1',
        amountCents: 5000,
        receivedOn: '2026-09-03',
        method: 'TRANSFER',
        allocations: [{ chargeId: 'a', amountCents: 9000 }],
      }),
    ).rejects.toThrow('billing.allocation_exceeds_payment')
  })

  it('rejects an allocation that exceeds its own charge\'s outstanding balance', async () => {
    const tx = {
      payment: { create: vi.fn().mockResolvedValue({}) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'a', outstandingCents: 3000 }]),
      paymentAllocation: { create: vi.fn() },
    }
    const prisma = fakePrisma({ $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)) })
    const service = new BillingService(prisma, fakeClientsService(client))

    await expect(
      service.recordPayment({
        clientId: 'c1',
        amountCents: 9000,
        receivedOn: '2026-09-03',
        method: 'TRANSFER',
        allocations: [{ chargeId: 'a', amountCents: 9000 }],
      }),
    ).rejects.toThrow('billing.allocation_exceeds_charge_balance')
  })

  it('accepts an empty allocations array — a payment recorded as pure credit', async () => {
    const tx = { payment: { create: vi.fn().mockResolvedValue({}) }, $queryRaw: vi.fn(), paymentAllocation: { create: vi.fn() } }
    const prisma = fakePrisma({ $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)) })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.recordPayment({ clientId: 'c1', amountCents: 9000, receivedOn: '2026-09-03', method: 'TRANSFER', allocations: [] })

    expect(result.paymentId).toEqual(expect.any(String))
    expect(tx.paymentAllocation.create).not.toHaveBeenCalled()
  })
})

describe('BillingService#createAdHocCharge', () => {
  it('creates an EXTRA charge with no plan', async () => {
    const prisma = fakePrisma({ charge: { create: vi.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve(data)) } })
    const service = new BillingService(prisma, fakeClientsService(client))

    const created = await service.createAdHocCharge({ clientId: 'c1', description: 'Consultoria extra', amountCents: 15000, dueOn: '2026-10-01' })

    expect(created).toMatchObject({ clientId: 'c1', kind: 'EXTRA', planId: null, periodLabel: null, amountCents: 15000 })
  })
})

describe('BillingService#writeOffCharge', () => {
  it('sets writtenOffAt and the reason', async () => {
    const prisma = fakePrisma({
      charge: {
        findUnique: vi.fn().mockResolvedValue({ id: 'a' }),
        update: vi.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'a', ...(data as object) })),
      },
    })
    const service = new BillingService(prisma, fakeClientsService(client))

    const result = await service.writeOffCharge('a', 'Cliente insolvente')

    expect(result).toMatchObject({ writeOffReason: 'Cliente insolvente', writtenOffAt: expect.any(Date) })
  })

  it('404s on an unknown charge', async () => {
    const prisma = fakePrisma({ charge: { findUnique: vi.fn().mockResolvedValue(null) } })
    const service = new BillingService(prisma, fakeClientsService(client))

    await expect(service.writeOffCharge('missing', 'reason')).rejects.toThrow('common.not_found')
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/api test -- billing.service`
Expected: FAIL — the four new methods don't exist on `BillingService` yet.

- [ ] **Step 3: Implement the four methods**

Add to `billing.service.ts`'s imports:

```ts
import { AppError, chargeDueDate, chargePeriodsSince, proposeAllocation } from '@ledger-hq/domain'
import type { ChargeBalance, CreateAdHocChargeInput, CreateRetainerPlanInput, ProposedAllocation, RecordPaymentInput, RenewRetainerPlanInput } from '@ledger-hq/domain'
import type { Charge, RetainerPlan } from '../generated/prisma/client.js'
```

Add to the `BillingService` class, after `renewRetainerPlan`:

```ts
  async proposeAllocationForClient(clientId: string, amountCents: number): Promise<{ proposed: ProposedAllocation[]; excessCents: number }> {
    const openCharges = await this.prisma.$queryRaw<ChargeBalance[]>`
      SELECT * FROM charge_balances WHERE "clientId" = ${clientId}::uuid AND "outstandingCents" > 0 ORDER BY "dueOn" ASC
    `
    const proposed = proposeAllocation(amountCents, openCharges)
    const allocatedCents = proposed.reduce((sum, allocation) => sum + allocation.amountCents, 0)
    return { proposed, excessCents: amountCents - allocatedCents }
  }

  /**
   * Persists the payment and every requested allocation atomically. Never
   * trusts the caller's arithmetic: re-validates against the payment's own
   * amount and each charge's *current* outstanding balance from
   * `charge_balances`, inside the same transaction, so a stale client-side
   * preview can never write an allocation the database wouldn't itself
   * justify.
   */
  async recordPayment(input: RecordPaymentInput): Promise<{ paymentId: string }> {
    const sumAllocated = input.allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0)
    if (sumAllocated > input.amountCents) throw new AppError('billing.allocation_exceeds_payment', {}, 422)

    return this.prisma.$transaction(async (tx) => {
      const paymentId = uuidv7()
      await tx.payment.create({
        data: {
          id: paymentId,
          clientId: input.clientId,
          amountCents: input.amountCents,
          receivedOn: new Date(`${input.receivedOn}T00:00:00Z`),
          method: input.method,
          reference: input.reference ?? null,
        },
      })

      for (const allocation of input.allocations) {
        const [balance] = await tx.$queryRaw<Array<{ outstandingCents: number }>>`
          SELECT "outstandingCents" FROM charge_balances WHERE id = ${allocation.chargeId}::uuid
        `
        if (!balance || allocation.amountCents > balance.outstandingCents) {
          throw new AppError('billing.allocation_exceeds_charge_balance', { chargeId: allocation.chargeId }, 422)
        }
        await tx.paymentAllocation.create({ data: { paymentId, chargeId: allocation.chargeId, amountCents: allocation.amountCents } })
      }

      return { paymentId }
    })
  }

  async createAdHocCharge(input: CreateAdHocChargeInput): Promise<Charge> {
    return this.prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId: input.clientId,
        kind: 'EXTRA',
        description: input.description,
        periodLabel: null,
        amountCents: input.amountCents,
        issuedOn: new Date(),
        dueOn: new Date(`${input.dueOn}T00:00:00Z`),
        planId: null,
      },
    })
  }

  async writeOffCharge(id: string, reason: string): Promise<Charge> {
    const charge = await this.prisma.charge.findUnique({ where: { id } })
    if (!charge) throw new AppError('common.not_found', {}, 404)

    return this.prisma.charge.update({ where: { id }, data: { writtenOffAt: new Date(), writeOffReason: reason } })
  }
```

Update `fakePrisma` in the test file to also stub `payment.create`, `paymentAllocation.create`, `charge.findUnique`/`update`, and a top-level `$queryRaw` default (`vi.fn().mockResolvedValue([])`), matching the shape the new tests' overrides expect.

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/api test -- billing.service`
Expected: PASS, all cases green (generator tests from Task 6 plus these).

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/api typecheck && pnpm --filter @ledger-hq/api lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/billing/billing.service.ts apps/api/src/billing/billing.service.test.ts
git commit -m "feat(api): add payment recording, ad-hoc charges, and write-off"
```

---

### Task 8: The three read views — receivables, current-month, and the per-client ledger

**Files:**
- Modify: `apps/api/src/billing/billing.service.ts`
- Create: `apps/api/test/billing.integration.test.ts`

**Interfaces:**
- Consumes: `charge_balances` (Task 5's view), `Charge`/`Payment`/`RetainerPlan` models.
- Produces (consumed by Task 9's controller):
  - `BillingService.getReceivables(asOf: Date): Promise<ReceivablesRow[]>`
  - `BillingService.getCurrentMonth(asOf: Date): Promise<CurrentMonthRow[]>`
  - `BillingService.getClientLedger(clientId: string): Promise<{ entries: LedgerEntry[]; balanceCents: number }>`
  - `type ReceivablesRow = { clientId: string; clientName: string; outstandingCents: number; oldestDueOn: string; ageingBucket: '0-30' | '31-60' | '61-90' | '90+' }`
  - `type CurrentMonthRow = { clientId: string; clientName: string; paid: boolean; outstandingCents: number }`
  - `type LedgerEntry = { type: 'CHARGE' | 'PAYMENT'; date: string; description: string; amountCents: number; runningBalanceCents: number }`

`asOf` is an explicit parameter on all three, not `new Date()` internally, for the same testability reason as every other date-driven function in this codebase — the controller (Task 9) is the only place that ever calls `new Date()`.

This is the first task that needs real Postgres rather than mocks — ageing-bucket arithmetic and the running-balance calculation are exactly the kind of logic worth proving against a real `charge_balances` view rather than a hand-maintained mock of one.

- [ ] **Step 1: Write the integration tests**

`apps/api/test/billing.integration.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from 'uuidv7'
import { getTestPrisma, resetDatabase } from './database.js'
import { BillingService } from '../src/billing/billing.service.js'
import { ClientsService } from '../src/clients/clients.service.js'

const prisma = getTestPrisma()
const billing = new BillingService(prisma, new ClientsService(prisma))

async function createClient(taxId: string, name = 'Test Client'): Promise<string> {
  const client = await prisma.client.create({
    data: { id: uuidv7(), kind: 'COMPANY', name, taxId, accounting: 'ORGANIZED', legalForm: 'LDA' },
  })
  return client.id
}

beforeEach(async () => {
  await resetDatabase()
})

describe('BillingService#getReceivables', () => {
  it('buckets outstanding balances by ageing, worst first', async () => {
    const clientId = await createClient('600000001', 'Old Debt Lda')
    await prisma.charge.create({
      data: {
        id: uuidv7(), clientId, kind: 'EXTRA', description: 'Old', amountCents: 10000,
        issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-01T00:00:00Z'),
      },
    })

    const rows = await billing.getReceivables(new Date('2026-04-01T00:00:00Z'))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ clientId, clientName: 'Old Debt Lda', outstandingCents: 10000, ageingBucket: '61-90' })
  })

  it('excludes a fully settled charge', async () => {
    const clientId = await createClient('600000002')
    const charge = await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'Paid', amountCents: 5000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-01T00:00:00Z') },
    })
    const payment = await prisma.payment.create({ data: { id: uuidv7(), clientId, amountCents: 5000, receivedOn: new Date('2026-01-05T00:00:00Z'), method: 'TRANSFER' } })
    await prisma.paymentAllocation.create({ data: { paymentId: payment.id, chargeId: charge.id, amountCents: 5000 } })

    const rows = await billing.getReceivables(new Date('2026-04-01T00:00:00Z'))

    expect(rows).toEqual([])
  })

  it('excludes a written-off charge', async () => {
    const clientId = await createClient('600000003')
    await prisma.charge.create({
      data: {
        id: uuidv7(), clientId, kind: 'EXTRA', description: 'Written off', amountCents: 5000,
        issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-01T00:00:00Z'),
        writtenOffAt: new Date('2026-02-01T00:00:00Z'), writeOffReason: 'Insolvent',
      },
    })

    const rows = await billing.getReceivables(new Date('2026-04-01T00:00:00Z'))

    expect(rows).toEqual([])
  })

  it('returns plain numbers, never bigint, for the aggregated cents columns', async () => {
    const clientId = await createClient('600000004')
    await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'X', amountCents: 5000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-01T00:00:00Z') },
    })

    const rows = await billing.getReceivables(new Date('2026-01-15T00:00:00Z'))

    expect(typeof rows[0]!.outstandingCents).toBe('number')
  })
})

describe('BillingService#getCurrentMonth', () => {
  it('reports a client as unpaid when this month\'s retainer charge is still open', async () => {
    const clientId = await createClient('600000005')
    const plan = await prisma.retainerPlan.create({
      data: { id: uuidv7(), clientId, amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z') },
    })
    await prisma.charge.create({
      data: { id: uuidv7(), clientId, planId: plan.id, kind: 'RETAINER', description: 'March', periodLabel: '2026-03', amountCents: 9000, issuedOn: new Date('2026-03-01T00:00:00Z'), dueOn: new Date('2026-03-08T00:00:00Z') },
    })

    const rows = await billing.getCurrentMonth(new Date('2026-03-18T00:00:00Z'))

    expect(rows).toContainEqual(expect.objectContaining({ clientId, paid: false, outstandingCents: 9000 }))
  })

  it('reports a client as paid once this month\'s charge is fully allocated', async () => {
    const clientId = await createClient('600000006')
    const plan = await prisma.retainerPlan.create({
      data: { id: uuidv7(), clientId, amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z') },
    })
    const charge = await prisma.charge.create({
      data: { id: uuidv7(), clientId, planId: plan.id, kind: 'RETAINER', description: 'March', periodLabel: '2026-03', amountCents: 9000, issuedOn: new Date('2026-03-01T00:00:00Z'), dueOn: new Date('2026-03-08T00:00:00Z') },
    })
    const payment = await prisma.payment.create({ data: { id: uuidv7(), clientId, amountCents: 9000, receivedOn: new Date('2026-03-05T00:00:00Z'), method: 'TRANSFER' } })
    await prisma.paymentAllocation.create({ data: { paymentId: payment.id, chargeId: charge.id, amountCents: 9000 } })

    const rows = await billing.getCurrentMonth(new Date('2026-03-18T00:00:00Z'))

    expect(rows).toContainEqual(expect.objectContaining({ clientId, paid: true, outstandingCents: 0 }))
  })
})

describe('BillingService#getClientLedger', () => {
  it('lists charges and payments chronologically with a running balance', async () => {
    const clientId = await createClient('600000007')
    const charge = await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'Consultoria', amountCents: 10000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-15T00:00:00Z') },
    })
    const payment = await prisma.payment.create({ data: { id: uuidv7(), clientId, amountCents: 4000, receivedOn: new Date('2026-01-10T00:00:00Z'), method: 'TRANSFER' } })
    await prisma.paymentAllocation.create({ data: { paymentId: payment.id, chargeId: charge.id, amountCents: 4000 } })

    const ledger = await billing.getClientLedger(clientId)

    expect(ledger.entries).toEqual([
      expect.objectContaining({ type: 'CHARGE', amountCents: 10000, runningBalanceCents: 10000 }),
      expect.objectContaining({ type: 'PAYMENT', amountCents: -4000, runningBalanceCents: 6000 }),
    ])
    expect(ledger.balanceCents).toBe(6000)
  })

  it('returns a zero balance and empty entries for a client with no billing history', async () => {
    const clientId = await createClient('600000008')

    const ledger = await billing.getClientLedger(clientId)

    expect(ledger).toEqual({ entries: [], balanceCents: 0 })
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/api test:integration -- billing.integration`
Expected: FAIL — the three new methods don't exist.

- [ ] **Step 3: Implement the three views**

Add to `billing.service.ts`, after `writeOffCharge`:

```ts
  async getReceivables(asOf: Date): Promise<Array<{ clientId: string; clientName: string; outstandingCents: number; oldestDueOn: string; ageingBucket: '0-30' | '31-60' | '61-90' | '90+' }>> {
    const rows = await this.prisma.$queryRaw<Array<{ clientId: string; clientName: string; outstandingCents: number; oldestDueOn: Date }>>`
      SELECT
        c.id AS "clientId",
        c.name AS "clientName",
        SUM(b."outstandingCents")::int AS "outstandingCents",
        MIN(b."dueOn") AS "oldestDueOn"
      FROM charge_balances b
      JOIN "Client" c ON c.id = b."clientId"
      WHERE b."outstandingCents" > 0 AND b.status != 'WRITTEN_OFF'
      GROUP BY c.id, c.name
      ORDER BY "oldestDueOn" ASC
    `

    return rows.map((row) => {
      const daysOverdue = Math.floor((asOf.getTime() - row.oldestDueOn.getTime()) / (24 * 60 * 60 * 1000))
      const ageingBucket = daysOverdue > 90 ? '90+' : daysOverdue > 60 ? '61-90' : daysOverdue > 30 ? '31-60' : '0-30'
      return { clientId: row.clientId, clientName: row.clientName, outstandingCents: row.outstandingCents, oldestDueOn: isoDate(row.oldestDueOn), ageingBucket }
    })
  }

  async getCurrentMonth(asOf: Date): Promise<Array<{ clientId: string; clientName: string; paid: boolean; outstandingCents: number }>> {
    const periodLabel = `${asOf.getUTCFullYear()}-${String(asOf.getUTCMonth() + 1).padStart(2, '0')}`

    const rows = await this.prisma.$queryRaw<Array<{ clientId: string; clientName: string; outstandingCents: number | null }>>`
      SELECT
        c.id AS "clientId",
        c.name AS "clientName",
        COALESCE(SUM(b."outstandingCents") FILTER (WHERE b."periodLabel" = ${periodLabel}), 0)::int AS "outstandingCents"
      FROM "RetainerPlan" p
      JOIN "Client" c ON c.id = p."clientId"
      LEFT JOIN charge_balances b ON b."clientId" = p."clientId" AND b."periodLabel" = ${periodLabel} AND b.kind = 'RETAINER'
      WHERE p."validFrom" <= ${asOf} AND (p."validTo" IS NULL OR p."validTo" >= ${asOf})
      GROUP BY c.id, c.name
    `

    return rows.map((row) => ({ clientId: row.clientId, clientName: row.clientName, paid: (row.outstandingCents ?? 0) === 0, outstandingCents: row.outstandingCents ?? 0 }))
  }

  async getClientLedger(clientId: string): Promise<{ entries: Array<{ type: 'CHARGE' | 'PAYMENT'; date: string; description: string; amountCents: number; runningBalanceCents: number }>; balanceCents: number }> {
    const charges = await this.prisma.charge.findMany({ where: { clientId }, orderBy: { issuedOn: 'asc' } })
    const payments = await this.prisma.payment.findMany({ where: { clientId }, orderBy: { receivedOn: 'asc' } })

    const events = [
      ...charges.map((charge) => ({ type: 'CHARGE' as const, date: charge.issuedOn, description: charge.description, amountCents: charge.amountCents })),
      ...payments.map((payment) => ({ type: 'PAYMENT' as const, date: payment.receivedOn, description: `Pagamento — ${payment.method}`, amountCents: -payment.amountCents })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime())

    let runningBalanceCents = 0
    const entries = events.map((event) => {
      runningBalanceCents += event.amountCents
      return { type: event.type, date: isoDate(event.date), description: event.description, amountCents: event.amountCents, runningBalanceCents }
    })

    return { entries, balanceCents: runningBalanceCents }
  }
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/api test:integration -- billing.integration`
Expected: PASS, all cases green.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/api typecheck && pnpm --filter @ledger-hq/api lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/billing/billing.service.ts apps/api/test/billing.integration.test.ts
git commit -m "feat(api): add the receivables, current-month, and client ledger views"
```

---

### Task 9: The billing controller

**Files:**
- Create: `apps/api/src/billing/billing.controller.ts`
- Modify: `apps/api/test/billing.integration.test.ts`

**Interfaces:**
- Consumes: every `BillingService` method (Tasks 6-8); all billing Zod schemas (Task 4); `SessionGuard`, `ZodValidationPipe` (Phase 0/Phase 1).
- Produces (consumed by Task 11's web `api.ts`): the 10 HTTP routes below.

| Method | Path | Body/Query |
|---|---|---|
| POST | `/billing/generate-charges` | query `dryRun`; body `{ asOf?, clientId? }` |
| POST | `/billing/clients/:clientId/retainer-plan` | `CreateRetainerPlanInput` |
| POST | `/billing/clients/:clientId/retainer-plan/renew` | `RenewRetainerPlanInput` |
| POST | `/billing/payments/propose-allocation` | `ProposeAllocationInput` |
| POST | `/billing/payments` | `RecordPaymentInput` |
| POST | `/billing/charges` | `CreateAdHocChargeInput` |
| PATCH | `/billing/charges/:id/write-off` | `WriteOffChargeInput` |
| GET | `/billing/receivables` | — |
| GET | `/billing/current-month` | — |
| GET | `/billing/clients/:clientId/ledger` | — |

- [ ] **Step 1: Write the controller integration tests**

Append to `apps/api/test/billing.integration.test.ts` (this file mixes service-level unit-style setup from Task 8 with these HTTP-level tests — both share the same `resetDatabase` beforeEach; check the file's existing style for how `obligations.integration.test.ts` bootstraps a session-authenticated `supertest` agent and mirror it exactly):

```ts
describe('BillingController', () => {
  it('generate-charges defaults to a dry run when the query param is omitted', async () => {
    const clientId = await createClient('600000009')
    await prisma.retainerPlan.create({
      data: { id: uuidv7(), clientId, amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z') },
    })

    const response = await post('/api/v1/billing/generate-charges', { asOf: '2026-01-15' })

    expect(response.status).toBe(201)
    expect(response.body.toCreate.length).toBeGreaterThan(0)
    const charges = await prisma.charge.findMany({ where: { clientId } })
    expect(charges).toHaveLength(0)
  })

  it('generate-charges applies when dryRun=false', async () => {
    const clientId = await createClient('600000010')
    await prisma.retainerPlan.create({
      data: { id: uuidv7(), clientId, amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: new Date('2026-01-01T00:00:00Z') },
    })

    await post('/api/v1/billing/generate-charges?dryRun=false', { asOf: '2026-01-15' })

    const charges = await prisma.charge.findMany({ where: { clientId } })
    expect(charges).toHaveLength(1)
  })

  it('creates a first retainer plan for a client', async () => {
    const clientId = await createClient('600000011')

    const response = await post(`/api/v1/billing/clients/${clientId}/retainer-plan`, {
      amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-01-01',
    })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ clientId, amountCents: 9000 })
  })

  it('rejects a second plan for a client that already has one in force', async () => {
    const clientId = await createClient('600000012')
    await post(`/api/v1/billing/clients/${clientId}/retainer-plan`, { amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-01-01' })

    const response = await post(`/api/v1/billing/clients/${clientId}/retainer-plan`, { amountCents: 12000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-02-01' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('billing.plan_overlap')
  })

  it('renews a retainer plan, closing the old one and creating a new one', async () => {
    const clientId = await createClient('600000013')
    await post(`/api/v1/billing/clients/${clientId}/retainer-plan`, { amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-01-01' })

    const response = await post(`/api/v1/billing/clients/${clientId}/retainer-plan/renew`, { newAmountCents: 12000, effectiveFrom: '2026-06-01' })

    expect(response.status).toBe(201)
    expect(response.body.newPlanId).toEqual(expect.any(String))
    const plans = await prisma.retainerPlan.findMany({ where: { clientId }, orderBy: { validFrom: 'asc' } })
    expect(plans).toHaveLength(2)
    expect(plans[0]!.validTo).toEqual(new Date('2026-05-31T00:00:00.000Z'))
  })

  it('proposes and then records a payment with allocations', async () => {
    const clientId = await createClient('600000014')
    const charge = await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'X', amountCents: 9000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-08T00:00:00Z') },
    })

    const proposal = await post('/api/v1/billing/payments/propose-allocation', { clientId, amountCents: 9000 })
    expect(proposal.body.proposed).toEqual([{ chargeId: charge.id, amountCents: 9000 }])

    const payment = await post('/api/v1/billing/payments', {
      clientId, amountCents: 9000, receivedOn: '2026-01-10', method: 'TRANSFER', allocations: proposal.body.proposed,
    })
    expect(payment.status).toBe(201)
  })

  it('creates an ad-hoc charge', async () => {
    const clientId = await createClient('600000015')

    const response = await post('/api/v1/billing/charges', { clientId, description: 'Extra', amountCents: 5000, dueOn: '2026-10-01' })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ clientId, kind: 'EXTRA' })
  })

  it('writes off a charge with a reason', async () => {
    const clientId = await createClient('600000016')
    const charge = await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'X', amountCents: 5000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-08T00:00:00Z') },
    })

    const response = await patch(`/api/v1/billing/charges/${charge.id}/write-off`, { reason: 'Cliente insolvente' })

    expect(response.status).toBe(200)
    expect(response.body.writeOffReason).toBe('Cliente insolvente')
  })

  it('422s a write-off with an empty reason', async () => {
    const clientId = await createClient('600000017')
    const charge = await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'X', amountCents: 5000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-08T00:00:00Z') },
    })

    const response = await patch(`/api/v1/billing/charges/${charge.id}/write-off`, { reason: '' })

    expect(response.status).toBe(422)
  })

  it('lists receivables', async () => {
    const clientId = await createClient('600000018')
    await prisma.charge.create({
      data: { id: uuidv7(), clientId, kind: 'EXTRA', description: 'X', amountCents: 5000, issuedOn: new Date('2026-01-01T00:00:00Z'), dueOn: new Date('2026-01-08T00:00:00Z') },
    })

    const response = await get('/api/v1/billing/receivables')

    expect(response.status).toBe(200)
    expect(response.body).toContainEqual(expect.objectContaining({ clientId, outstandingCents: 5000 }))
  })

  it('lists the current month\'s retainer status', async () => {
    const response = await get('/api/v1/billing/current-month')
    expect(response.status).toBe(200)
    expect(Array.isArray(response.body)).toBe(true)
  })

  it('returns a client\'s ledger', async () => {
    const clientId = await createClient('600000019')

    const response = await get(`/api/v1/billing/clients/${clientId}/ledger`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ entries: [], balanceCents: 0 })
  })
})
```

(`post`/`get`/`patch` here are whatever helper functions `obligations.integration.test.ts` already defines for an authenticated `supertest` agent — reuse them, don't redefine.)

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/api test:integration -- billing.integration`
Expected: FAIL — every route 404s, `BillingController` doesn't exist yet.

- [ ] **Step 3: Implement the controller**

`apps/api/src/billing/billing.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import {
  createAdHocChargeSchema,
  createRetainerPlanSchema,
  generateChargesBodySchema,
  generateChargesQuerySchema,
  proposeAllocationSchema,
  recordPaymentSchema,
  renewRetainerPlanSchema,
  writeOffChargeSchema,
} from '@ledger-hq/domain'
import type {
  CreateAdHocChargeInput,
  CreateRetainerPlanInput,
  GenerateChargesInput,
  GenerateChargesQuery,
  ProposeAllocationInput,
  RecordPaymentInput,
  RenewRetainerPlanInput,
  WriteOffChargeInput,
} from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { BillingService } from './billing.service.js'
import type { GenerateChargesResult } from './billing.service.js'

@Controller('billing')
@UseGuards(SessionGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('generate-charges')
  async generateCharges(
    @Query(new ZodValidationPipe(generateChargesQuerySchema)) query: GenerateChargesQuery,
    @Body(new ZodValidationPipe(generateChargesBodySchema)) body: GenerateChargesInput,
  ): Promise<GenerateChargesResult> {
    const asOf = body.asOf ? new Date(`${body.asOf}T00:00:00Z`) : new Date()
    // Same safe-default ruling as the obligation generator (Phase 2): an
    // omitted or malformed dryRun never applies.
    return this.billing.generateCharges(
      { asOf, ...(body.clientId !== undefined ? { clientId: body.clientId } : {}) },
      query.dryRun !== 'false',
    )
  }

  @Post('clients/:clientId/retainer-plan')
  async createRetainerPlan(
    @Param('clientId') clientId: string,
    @Body(new ZodValidationPipe(createRetainerPlanSchema)) body: CreateRetainerPlanInput,
  ) {
    return this.billing.createRetainerPlan(clientId, body)
  }

  @Post('clients/:clientId/retainer-plan/renew')
  async renewRetainerPlan(
    @Param('clientId') clientId: string,
    @Body(new ZodValidationPipe(renewRetainerPlanSchema)) body: RenewRetainerPlanInput,
  ) {
    return this.billing.renewRetainerPlan(clientId, body)
  }

  @Post('payments/propose-allocation')
  async proposeAllocation(@Body(new ZodValidationPipe(proposeAllocationSchema)) body: ProposeAllocationInput) {
    return this.billing.proposeAllocationForClient(body.clientId, body.amountCents)
  }

  @Post('payments')
  async recordPayment(@Body(new ZodValidationPipe(recordPaymentSchema)) body: RecordPaymentInput) {
    return this.billing.recordPayment(body)
  }

  @Post('charges')
  async createAdHocCharge(@Body(new ZodValidationPipe(createAdHocChargeSchema)) body: CreateAdHocChargeInput) {
    return this.billing.createAdHocCharge(body)
  }

  @Patch('charges/:id/write-off')
  async writeOffCharge(@Param('id') id: string, @Body(new ZodValidationPipe(writeOffChargeSchema)) body: WriteOffChargeInput) {
    return this.billing.writeOffCharge(id, body.reason)
  }

  @Get('receivables')
  async receivables() {
    return this.billing.getReceivables(new Date())
  }

  @Get('current-month')
  async currentMonth() {
    return this.billing.getCurrentMonth(new Date())
  }

  @Get('clients/:clientId/ledger')
  async ledger(@Param('clientId') clientId: string) {
    return this.billing.getClientLedger(clientId)
  }
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/api test:integration -- billing.integration`
Expected: still 404 on every route — `BillingModule` isn't registered yet (Task 10). Confirm the failures are all 404s with no hidden 500 behind them, the same "expected, not a hidden bug" state Phase 2's Tasks 10/11 left themselves in.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/api typecheck && pnpm --filter @ledger-hq/api lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/billing/billing.controller.ts apps/api/test/billing.integration.test.ts
git commit -m "feat(api): add the billing controller"
```

---

### Task 10: Wire the module, add the daily cron, translate error codes

**Files:**
- Create: `apps/api/src/billing/billing.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/web/src/i18n/locales/pt/errors.json`, `apps/web/src/i18n/locales/en/errors.json`

**Interfaces:**
- Consumes: `BillingService`, `BillingController` (Tasks 6-9); `AuthModule`, `ClientsModule` (Phase 0).
- Produces: charge generation running daily, and the 4 new `billing.*` error codes translated.

**Preflight note, settled during authoring, not left for a reviewer to catch:** `BillingModule` does **not** import `ScheduleModule` at all, and does **not** call `ScheduleModule.forRoot()`. That call already happened once, in `ObligationsModule` (Phase 2 Task 12) — `@nestjs/schedule`'s cron discovery scans every provider in the app once `forRoot()` has bootstrapped anywhere, regardless of which feature module a `@Cron`-decorated class lives in. A second `forRoot()` call here would be either redundant or (per NestJS's own module-instantiation semantics) liable to register the schedule explorer twice. `BillingCron` just needs to be a registered provider; the decorator does the rest.

- [ ] **Step 1: Write the cron test**

`apps/api/src/billing/billing.cron.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { BillingService } from './billing.service.js'
import { BillingCron } from './billing.cron.js'

describe('BillingCron', () => {
  it('runs generateCharges for every client, applied, as of now', async () => {
    const generateCharges = vi.fn().mockResolvedValue({ toCreate: [] })
    const cron = new BillingCron({ generateCharges } as unknown as BillingService)

    await cron.runDailyGeneration()

    expect(generateCharges).toHaveBeenCalledWith({ asOf: expect.any(Date) }, false)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/api test -- billing.cron`
Expected: FAIL — `./billing.cron` does not exist.

- [ ] **Step 3: Implement the cron**

`apps/api/src/billing/billing.cron.ts`:

```ts
import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { BillingService } from './billing.service.js'

/**
 * Same shape as ObligationsCron (Phase 2): kept separate from the service
 * so BillingService itself carries zero `@nestjs/schedule` coupling.
 * Registered as a plain provider, not via a second `ScheduleModule.forRoot()`
 * call — see BillingModule's own comment on why.
 */
@Injectable()
export class BillingCron {
  constructor(private readonly billing: BillingService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDailyGeneration(): Promise<void> {
    await this.billing.generateCharges({ asOf: new Date() }, false)
  }
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/api test -- billing.cron`
Expected: PASS.

- [ ] **Step 5: Wire the module**

`apps/api/src/billing/billing.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ClientsModule } from '../clients/clients.module.js'
import { PrismaService } from '../common/prisma.service.js'
import { BillingController } from './billing.controller.js'
import { BillingService } from './billing.service.js'
import { BillingCron } from './billing.cron.js'

@Module({
  imports: [AuthModule, ClientsModule],
  controllers: [BillingController],
  providers: [BillingService, BillingCron, PrismaService],
})
export class BillingModule {}
```

Register it in `apps/api/src/app.module.ts`, after `ObligationsModule`:

```ts
import { BillingModule } from './billing/billing.module.js'
```

```ts
    ObligationsModule,
    BillingModule,
    SystemModule,
```

- [ ] **Step 6: Translate the error codes**

Add to `apps/web/src/i18n/locales/pt/errors.json`, as a new top-level key after `obligations`:

```json
  "billing": {
    "write_off_reason_required": "Indica o motivo do perdão da dívida.",
    "allocation_exceeds_payment": "A soma das alocações excede o valor do pagamento.",
    "allocation_exceeds_charge_balance": "O valor alocado excede o saldo em aberto desta cobrança.",
    "plan_overlap": "Já existe um plano de retainer em vigor para este cliente."
  }
```

Add the equivalent to `apps/web/src/i18n/locales/en/errors.json`:

```json
  "billing": {
    "write_off_reason_required": "Enter a reason for writing off this debt.",
    "allocation_exceeds_payment": "The sum of allocations exceeds the payment amount.",
    "allocation_exceeds_charge_balance": "The allocated amount exceeds this charge's open balance.",
    "plan_overlap": "A retainer plan is already in force for this client."
  }
```

- [ ] **Step 7: Run the full backend suite**

```bash
pnpm --filter @ledger-hq/api test
pnpm --filter @ledger-hq/api test:integration
pnpm --filter @ledger-hq/web i18n:check
```

Expected: everything green, including every previously-404ing billing integration test from Task 9.

- [ ] **Step 8: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/api typecheck && pnpm --filter @ledger-hq/api lint`
Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/billing/billing.module.ts apps/api/src/billing/billing.cron.ts apps/api/src/billing/billing.cron.test.ts \
  apps/api/src/app.module.ts apps/web/src/i18n/locales/pt/errors.json apps/web/src/i18n/locales/en/errors.json
git commit -m "feat(api): wire the billing module in, with a daily generation cron"
```

---

### Task 11: Web API client and locales

**Files:**
- Create: `apps/web/src/billing/api.ts`
- Create: `apps/web/src/i18n/locales/pt/billing.json`, `apps/web/src/i18n/locales/en/billing.json`
- Modify: `apps/web/src/i18n/locales/pt/domain.json`, `apps/web/src/i18n/locales/en/domain.json`
- Modify: `apps/web/src/i18n/locales/pt/index.ts`, `apps/web/src/i18n/locales/en/index.ts`

**Interfaces:**
- Consumes: `apiFetch` (Phase 0).
- Produces (consumed by Tasks 12-16):
  - `getReceivables()`, `getCurrentMonth()`, `getClientLedger(clientId)`, `generateCharges(input, dryRun)`, `proposeAllocation(clientId, amountCents)`, `recordPayment(input)`, `createRetainerPlan(clientId, input)`, `renewRetainerPlan(clientId, input)`, `createAdHocCharge(input)`, `writeOffCharge(id, reason)` — all from `apps/web/src/billing/api.ts`.
  - A registered `billing` locale namespace, and a new `paymentMethod`/`chargeStatus` block in `domain.json`.

- [ ] **Step 1: Write the API client**

`apps/web/src/billing/api.ts`:

```ts
import { apiFetch } from '../api/client'

export type ReceivablesRow = {
  clientId: string
  clientName: string
  outstandingCents: number
  oldestDueOn: string
  ageingBucket: '0-30' | '31-60' | '61-90' | '90+'
}

export type CurrentMonthRow = { clientId: string; clientName: string; paid: boolean; outstandingCents: number }

export type LedgerEntry = { type: 'CHARGE' | 'PAYMENT'; date: string; description: string; amountCents: number; runningBalanceCents: number }

export type ClientLedger = { entries: LedgerEntry[]; balanceCents: number }

export type GenerateChargesResult = {
  toCreate: Array<{ clientId: string; planId: string; periodLabel: string; amountCents: number; dueOn: string }>
}

export type RetainerPlan = {
  id: string
  clientId: string
  amountCents: number
  periodicity: string
  dueDayOfMonth: number
  validFrom: string
  validTo: string | null
}

export type ProposedAllocation = { chargeId: string; amountCents: number }

export type Charge = {
  id: string
  clientId: string
  kind: string
  description: string
  periodLabel: string | null
  amountCents: number
  dueOn: string
  writtenOffAt: string | null
  writeOffReason: string | null
}

export function getReceivables(): Promise<ReceivablesRow[]> {
  return apiFetch('/billing/receivables')
}

export function getCurrentMonth(): Promise<CurrentMonthRow[]> {
  return apiFetch('/billing/current-month')
}

export function getClientLedger(clientId: string): Promise<ClientLedger> {
  return apiFetch(`/billing/clients/${clientId}/ledger`)
}

export function generateCharges(input: { asOf?: string; clientId?: string }, dryRun: boolean): Promise<GenerateChargesResult> {
  return apiFetch(`/billing/generate-charges?dryRun=${dryRun}`, { method: 'POST', body: input })
}

export function proposeAllocation(clientId: string, amountCents: number): Promise<{ proposed: ProposedAllocation[]; excessCents: number }> {
  return apiFetch('/billing/payments/propose-allocation', { method: 'POST', body: { clientId, amountCents } })
}

export function recordPayment(input: {
  clientId: string
  amountCents: number
  receivedOn: string
  method: string
  reference?: string
  allocations: ProposedAllocation[]
}): Promise<{ paymentId: string }> {
  return apiFetch('/billing/payments', { method: 'POST', body: input })
}

export function createRetainerPlan(
  clientId: string,
  input: { amountCents: number; periodicity: string; dueDayOfMonth: number; validFrom: string },
): Promise<RetainerPlan> {
  return apiFetch(`/billing/clients/${clientId}/retainer-plan`, { method: 'POST', body: input })
}

export function renewRetainerPlan(
  clientId: string,
  input: { newAmountCents: number; effectiveFrom: string; periodicity?: string; dueDayOfMonth?: number },
): Promise<{ closedPlanId: string | null; newPlanId: string }> {
  return apiFetch(`/billing/clients/${clientId}/retainer-plan/renew`, { method: 'POST', body: input })
}

export function createAdHocCharge(input: { clientId: string; description: string; amountCents: number; dueOn: string }): Promise<Charge> {
  return apiFetch('/billing/charges', { method: 'POST', body: input })
}

export function writeOffCharge(id: string, reason: string): Promise<Charge> {
  return apiFetch(`/billing/charges/${id}/write-off`, { method: 'PATCH', body: { reason } })
}
```

(Check `apps/web/src/api/client.ts`'s exact `apiFetch` signature — Phase 2's `obligations/api.ts` is the closest reference for the `{ method, body }` calling convention; mirror it exactly, including how it handles a `POST`/`PATCH` with no body versus one with a JSON body.)

- [ ] **Step 2: Write the locale files**

`apps/web/src/i18n/locales/pt/billing.json`:

```json
{
  "receivables": {
    "title": "Recebíveis",
    "empty": "Sem valores em atraso.",
    "bucket": {
      "0-30": "0-30 dias",
      "31-60": "31-60 dias",
      "61-90": "61-90 dias",
      "90+": "Mais de 90 dias"
    }
  },
  "ledger": {
    "title": "Faturação",
    "balance": "Saldo",
    "empty": "Sem movimentos de faturação.",
    "charge": "Cobrança",
    "payment": "Pagamento"
  },
  "retainerPlan": {
    "createTitle": "Criar plano de retainer",
    "renewTitle": "Atualizar valor",
    "amountCents": { "label": "Valor mensal (cêntimos)" },
    "newAmountCents": { "label": "Novo valor (cêntimos)" },
    "periodicity": { "label": "Periodicidade" },
    "dueDayOfMonth": { "label": "Dia de vencimento" },
    "validFrom": { "label": "Em vigor desde" },
    "effectiveFrom": { "label": "Novo valor a partir de" }
  },
  "payment": {
    "recordTitle": "Registar pagamento",
    "amountCents": { "label": "Valor (cêntimos)" },
    "receivedOn": { "label": "Data de receção" },
    "method": { "label": "Método" },
    "reference": { "label": "Referência" },
    "propose": "Propor alocação",
    "confirm": "Confirmar",
    "excess": "Sobra {{amount}} por alocar (fica como crédito)."
  },
  "adHocCharge": {
    "newTitle": "Nova cobrança avulsa",
    "description": { "label": "Descrição" },
    "amountCents": { "label": "Valor (cêntimos)" },
    "dueOn": { "label": "Data de vencimento" }
  },
  "writeOff": {
    "action": "Perdoar dívida",
    "reason": { "label": "Motivo" }
  }
}
```

`apps/web/src/i18n/locales/en/billing.json`:

```json
{
  "receivables": {
    "title": "Receivables",
    "empty": "No outstanding balances.",
    "bucket": {
      "0-30": "0-30 days",
      "31-60": "31-60 days",
      "61-90": "61-90 days",
      "90+": "90+ days"
    }
  },
  "ledger": {
    "title": "Billing",
    "balance": "Balance",
    "empty": "No billing activity.",
    "charge": "Charge",
    "payment": "Payment"
  },
  "retainerPlan": {
    "createTitle": "Create retainer plan",
    "renewTitle": "Update fee",
    "amountCents": { "label": "Monthly amount (cents)" },
    "newAmountCents": { "label": "New amount (cents)" },
    "periodicity": { "label": "Periodicity" },
    "dueDayOfMonth": { "label": "Due day of month" },
    "validFrom": { "label": "In force from" },
    "effectiveFrom": { "label": "New amount from" }
  },
  "payment": {
    "recordTitle": "Record payment",
    "amountCents": { "label": "Amount (cents)" },
    "receivedOn": { "label": "Received on" },
    "method": { "label": "Method" },
    "reference": { "label": "Reference" },
    "propose": "Propose allocation",
    "confirm": "Confirm",
    "excess": "{{amount}} left unallocated (becomes credit)."
  },
  "adHocCharge": {
    "newTitle": "New ad-hoc charge",
    "description": { "label": "Description" },
    "amountCents": { "label": "Amount (cents)" },
    "dueOn": { "label": "Due date" }
  },
  "writeOff": {
    "action": "Write off",
    "reason": { "label": "Reason" }
  }
}
```

- [ ] **Step 3: Add the `paymentMethod`/`chargeStatus` domain blocks**

Add to `apps/web/src/i18n/locales/pt/domain.json`:

```json
  "paymentMethod": {
    "TRANSFER": "Transferência",
    "CASH": "Numerário",
    "DIRECT_DEBIT": "Débito direto",
    "OTHER": "Outro"
  },
  "chargeStatus": {
    "OPEN": "Em aberto",
    "PARTIAL": "Parcialmente pago",
    "SETTLED": "Liquidado",
    "WRITTEN_OFF": "Perdoado"
  }
```

Add the equivalent to `apps/web/src/i18n/locales/en/domain.json`:

```json
  "paymentMethod": {
    "TRANSFER": "Transfer",
    "CASH": "Cash",
    "DIRECT_DEBIT": "Direct debit",
    "OTHER": "Other"
  },
  "chargeStatus": {
    "OPEN": "Open",
    "PARTIAL": "Partially paid",
    "SETTLED": "Settled",
    "WRITTEN_OFF": "Written off"
  }
```

- [ ] **Step 4: Register the namespace**

Add to `apps/web/src/i18n/locales/pt/index.ts` and `en/index.ts`:

```ts
import billing from './billing.json'
```

```ts
export const resources = { billing, clients, common, domain, employments, errors, obligations, vault }
```

- [ ] **Step 5: Verify and typecheck**

Run: `pnpm --filter @ledger-hq/web i18n:check && pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/billing/api.ts apps/web/src/i18n/locales/pt/billing.json apps/web/src/i18n/locales/en/billing.json \
  apps/web/src/i18n/locales/pt/domain.json apps/web/src/i18n/locales/en/domain.json \
  apps/web/src/i18n/locales/pt/index.ts apps/web/src/i18n/locales/en/index.ts
git commit -m "feat(web): add the billing API client and locale namespace"
```

---

### Task 12: `ReceivablesSection` and the `HomePage` wrapper

**Files:**
- Create: `apps/web/src/billing/ReceivablesSection.tsx`
- Create: `apps/web/src/billing/ReceivablesSection.test.tsx`
- Create: `apps/web/src/HomePage.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Consumes: `getReceivables` (Task 11); `ObligationsDashboard` (`./obligations/ObligationsDashboard`, Phase 2 — unmodified, imported as-is).
- Produces: the app's new home page.

`ObligationsDashboard` itself is not touched by this task. It already renders its own complete `<section>` with its own heading (Phase 2, Task 15) — `HomePage` composes it with the new `ReceivablesSection` as a sibling, exactly the "page combines them, modules stay ignorant of each other" split the design doc calls for (§3.4). `router.tsx`'s `indexRoute` changes from pointing at `ObligationsDashboard` directly to pointing at the new `HomePage`.

- [ ] **Step 1: Write the `ReceivablesSection` test**

`apps/web/src/billing/ReceivablesSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const getReceivablesMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getReceivables: getReceivablesMock }))

const { ReceivablesSection } = await import('./ReceivablesSection')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ReceivablesSection />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('ReceivablesSection', () => {
  beforeEach(() => {
    getReceivablesMock.mockReset()
  })

  it('shows the empty state when nothing is outstanding', async () => {
    getReceivablesMock.mockResolvedValue([])
    renderSection()
    expect(await screen.findByText(/sem valores em atraso/i)).toBeInTheDocument()
  })

  it('lists a client with an outstanding balance and its ageing bucket', async () => {
    getReceivablesMock.mockResolvedValue([
      { clientId: 'c1', clientName: 'Padaria Central', outstandingCents: 27000, oldestDueOn: '2026-01-08', ageingBucket: '61-90' },
    ])
    renderSection()
    expect(await screen.findByText(/padaria central/i)).toBeInTheDocument()
    expect(screen.getByText(/61-90/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- ReceivablesSection`
Expected: FAIL — `./ReceivablesSection` does not exist.

- [ ] **Step 3: Implement `ReceivablesSection`**

`apps/web/src/billing/ReceivablesSection.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { getReceivables } from './api'
import { formatCurrency } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'

export function ReceivablesSection() {
  const { t, i18n } = useTranslation('billing')

  const receivables = useQuery({ queryKey: ['receivables'], queryFn: getReceivables })

  if (receivables.isPending) return null
  if (receivables.isError) return <ErrorMessage error={receivables.error} />

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t('receivables.title')}</h2>

      {receivables.data.length === 0 ? (
        <p className="text-sm text-slate-600">{t('receivables.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {receivables.data.map((row) => (
            <li key={row.clientId} className="flex items-center justify-between rounded border border-slate-200 bg-white p-3 text-sm">
              <span>{row.clientName}</span>
              <span className="flex items-center gap-3">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{t(`receivables.bucket.${row.ageingBucket}`)}</span>
                <span className="font-medium">{formatCurrency(row.outstandingCents, i18n.language as SupportedLocale)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

`apps/web/src/i18n/format.ts` already has `formatCurrency(amountCents: number, locale: SupportedLocale): string` (EUR, forced thousands grouping) — this and every later task that displays a monetary value reuse it rather than adding a second formatter.

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- ReceivablesSection`
Expected: PASS.

- [ ] **Step 5: Write the `HomePage` wrapper**

`apps/web/src/HomePage.tsx`:

```tsx
import { ObligationsDashboard } from './obligations/ObligationsDashboard'
import { ReceivablesSection } from './billing/ReceivablesSection'

export function HomePage() {
  return (
    <div className="flex flex-col gap-8">
      <ObligationsDashboard />
      <ReceivablesSection />
    </div>
  )
}
```

- [ ] **Step 6: Point the index route at `HomePage`**

In `apps/web/src/router.tsx`, replace:

```ts
import { ObligationsDashboard } from './obligations/ObligationsDashboard'
```

with:

```ts
import { HomePage } from './HomePage'
```

and change `indexRoute`'s `component` from `ObligationsDashboard` to `HomePage`. No other route changes.

- [ ] **Step 7: Run the full web suite, typecheck, and lint**

Run: `pnpm --filter @ledger-hq/web test && pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: everything green, including `ObligationsDashboard.test.tsx` unchanged and still passing (it renders the component in isolation, not through the router, so `HomePage`'s existence doesn't affect it).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/billing/ReceivablesSection.tsx apps/web/src/billing/ReceivablesSection.test.tsx \
  apps/web/src/HomePage.tsx apps/web/src/router.tsx
git commit -m "feat(web): add the receivables section and compose it into the home page"
```

---

### Task 13: `ClientLedgerSection` — per-client billing ledger and retainer plan management

**Files:**
- Create: `apps/web/src/billing/ClientLedgerSection.tsx`
- Create: `apps/web/src/billing/RetainerPlanForm.tsx`
- Create: `apps/web/src/billing/ClientLedgerSection.test.tsx`
- Modify: `apps/web/src/clients/ClientDetailPage.tsx`

**Interfaces:**
- Consumes: `getClientLedger`, `createRetainerPlan`, `renewRetainerPlan` (Task 11).
- Produces (consumed by Tasks 14-16, which extend this same section): `ClientLedgerSection`, rendered in `ClientDetailPage` right after `ObligationsSection` (Phase 2) and before `EmploymentSection` — billing sits alongside obligations in the same "what does this client owe/need" cluster on the page, ahead of the more administrative `EmploymentSection`/`CredentialsSection`.

`RetainerPlanForm` covers both the design doc's "create first plan" and "renew" flows (§3.3) in one component: if `currentPlan` is `null`, it renders the create form; otherwise the renew form, defaulting the optional `periodicity`/`dueDayOfMonth` fields to the current plan's own values so a pure fee change never has to touch them.

- [ ] **Step 1: Write the section test**

`apps/web/src/billing/ClientLedgerSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const getClientLedgerMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getClientLedger: getClientLedgerMock }))

const { ClientLedgerSection } = await import('./ClientLedgerSection')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ClientLedgerSection clientId="c1" />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('ClientLedgerSection', () => {
  beforeEach(() => {
    getClientLedgerMock.mockReset()
  })

  it('shows the empty state with no billing history', async () => {
    getClientLedgerMock.mockResolvedValue({ entries: [], balanceCents: 0 })
    renderSection()
    expect(await screen.findByText(/sem movimentos de faturação/i)).toBeInTheDocument()
  })

  it('lists charge and payment entries with the running balance', async () => {
    getClientLedgerMock.mockResolvedValue({
      entries: [
        { type: 'CHARGE', date: '2026-01-01', description: 'Retainer — 2026-01', amountCents: 9000, runningBalanceCents: 9000 },
        { type: 'PAYMENT', date: '2026-01-10', description: 'Pagamento — TRANSFER', amountCents: -9000, runningBalanceCents: 0 },
      ],
      balanceCents: 0,
    })
    renderSection()
    expect(await screen.findByText(/retainer — 2026-01/i)).toBeInTheDocument()
    expect(screen.getByText(/pagamento — transfer/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- ClientLedgerSection`
Expected: FAIL — `./ClientLedgerSection` does not exist.

- [ ] **Step 3: Implement `RetainerPlanForm`**

`apps/web/src/billing/RetainerPlanForm.tsx`:

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PERIODICITY_VALUES } from '@ledger-hq/domain'
import type { Periodicity } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { createRetainerPlan, renewRetainerPlan } from './api'
import type { RetainerPlan } from './api'

type Props = { clientId: string; currentPlan: RetainerPlan | null; onSaved: () => void }

export function RetainerPlanForm({ clientId, currentPlan, onSaved }: Props) {
  const { t } = useTranslation(['billing', 'domain', 'common'])
  const isRenewal = currentPlan !== null

  const [amountCents, setAmountCents] = useState('')
  const [periodicity, setPeriodicity] = useState<Periodicity>((currentPlan?.periodicity as Periodicity | undefined) ?? 'MONTHLY')
  const [dueDayOfMonth, setDueDayOfMonth] = useState(String(currentPlan?.dueDayOfMonth ?? 8))
  const [effectiveDate, setEffectiveDate] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      isRenewal
        ? renewRetainerPlan(clientId, { newAmountCents: Number(amountCents), effectiveFrom: effectiveDate })
        : createRetainerPlan(clientId, { amountCents: Number(amountCents), periodicity, dueDayOfMonth: Number(dueDayOfMonth), validFrom: effectiveDate }),
    onSuccess: () => {
      setAmountCents('')
      setEffectiveDate('')
      onSaved()
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
      <h3 className="font-medium">{t(isRenewal ? 'billing:retainerPlan.renewTitle' : 'billing:retainerPlan.createTitle')}</h3>

      <label className="flex flex-col gap-1 text-sm">
        {t(isRenewal ? 'billing:retainerPlan.newAmountCents.label' : 'billing:retainerPlan.amountCents.label')}
        <input
          type="number"
          required
          min={1}
          value={amountCents}
          onChange={(event) => setAmountCents(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      {!isRenewal && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            {t('billing:retainerPlan.periodicity.label')}
            <select
              value={periodicity}
              onChange={(event) => setPeriodicity(event.target.value as Periodicity)}
              className="rounded border border-slate-300 px-2 py-1"
            >
              {PERIODICITY_VALUES.filter((value) => value !== 'ONE_OFF').map((value) => (
                <option key={value} value={value}>
                  {t(`domain:periodicity.${value}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            {t('billing:retainerPlan.dueDayOfMonth.label')}
            <input
              type="number"
              required
              min={1}
              max={28}
              value={dueDayOfMonth}
              onChange={(event) => setDueDayOfMonth(event.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </label>
        </>
      )}

      <label className="flex flex-col gap-1 text-sm">
        {t(isRenewal ? 'billing:retainerPlan.effectiveFrom.label' : 'billing:retainerPlan.validFrom.label')}
        <input
          type="date"
          required
          value={effectiveDate}
          onChange={(event) => setEffectiveDate(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <ErrorMessage error={mutation.error} />

      <button
        type="submit"
        disabled={mutation.isPending}
        className="self-start rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {t('common:actions.save')}
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Implement `ClientLedgerSection`**

`apps/web/src/billing/ClientLedgerSection.tsx`:

```tsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatCurrency } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { getClientLedger } from './api'
import { RetainerPlanForm } from './RetainerPlanForm'

export function ClientLedgerSection({ clientId }: { clientId: string }) {
  const { t, i18n } = useTranslation(['billing', 'common'])
  const queryClient = useQueryClient()
  const [showPlanForm, setShowPlanForm] = useState(false)

  const ledger = useQuery({ queryKey: ['client-ledger', clientId], queryFn: () => getClientLedger(clientId) })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['client-ledger', clientId] })

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t('billing:ledger.title')}</h2>
        <button
          type="button"
          onClick={() => setShowPlanForm((value) => !value)}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          {t('common:actions.edit')}
        </button>
      </div>

      {showPlanForm && (
        <RetainerPlanForm
          clientId={clientId}
          currentPlan={null}
          onSaved={() => {
            setShowPlanForm(false)
            invalidate()
          }}
        />
      )}

      {ledger.isPending ? null : ledger.isError ? (
        <ErrorMessage error={ledger.error} />
      ) : ledger.data.entries.length === 0 ? (
        <p className="text-sm text-slate-600">{t('billing:ledger.empty')}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {ledger.data.entries.map((entry, index) => (
              <li key={index} className="flex items-center justify-between text-sm">
                <span>{entry.description}</span>
                <span className={entry.amountCents < 0 ? 'text-green-700' : ''}>
                  {formatCurrency(entry.amountCents, i18n.language as SupportedLocale)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm font-medium">
            <span>{t('billing:ledger.balance')}</span>
            <span>{formatCurrency(ledger.data.balanceCents, i18n.language as SupportedLocale)}</span>
          </div>
        </>
      )}
    </section>
  )
}
```

`currentPlan={null}` is hardcoded here deliberately — this task only wires the "create a first plan" path end to end and proves it with the tests above. Task 14 replaces this `null` with a real query for the client's current plan once payment recording exists alongside it, so the renew path can be tested against a plan that's actually there to renew.

- [ ] **Step 5: Wire into `ClientDetailPage`**

In `apps/web/src/clients/ClientDetailPage.tsx`, add the import and render it right after `<ObligationsSection clientId={clientId} />`:

```tsx
import { ClientLedgerSection } from '../billing/ClientLedgerSection'
```

```tsx
      <ObligationsSection clientId={clientId} />
      <ClientLedgerSection clientId={clientId} />

      <EmploymentSection client={{ id: record.id, kind: record.kind, name: record.name }} />
```

- [ ] **Step 6: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- ClientLedgerSection && pnpm --filter @ledger-hq/web test`
Expected: PASS. The full suite run confirms `ClientDetailPage`'s own tests (if any query the page's rendered sections by heading) still pass with the new section present.

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/billing/ClientLedgerSection.tsx apps/web/src/billing/RetainerPlanForm.tsx \
  apps/web/src/billing/ClientLedgerSection.test.tsx apps/web/src/clients/ClientDetailPage.tsx
git commit -m "feat(web): add the per-client billing ledger and retainer plan creation"
```

---

### Task 14: `RecordPaymentForm` — propose, confirm, and write off

**Files:**
- Create: `apps/web/src/billing/RecordPaymentForm.tsx`
- Modify: `apps/web/src/billing/ClientLedgerSection.tsx`
- Modify: `apps/web/src/billing/ClientLedgerSection.test.tsx`

**Interfaces:**
- Consumes: `proposeAllocation`, `recordPayment`, `writeOffCharge` (Task 11).
- Produces: the propose → confirm flow (design doc §3.2) and a write-off action, both wired into `ClientLedgerSection`.

The design doc is explicit that the proposal must never auto-apply: recording a payment is a two-step UI flow, not one submit. `RecordPaymentForm` renders the input fields first; once the owner clicks "Propose allocation," it fetches the FIFO proposal, then shows an editable table of `{ chargeId, amountCents }` rows the owner can adjust before a second, separate "Confirm" submit actually calls `recordPayment`.

- [ ] **Step 1: Extend `ClientLedgerSection`'s test with the payment/write-off flow**

Add to `apps/web/src/billing/ClientLedgerSection.test.tsx`:

```tsx
const proposeAllocationMock = vi.hoisted(() => vi.fn())
const recordPaymentMock = vi.hoisted(() => vi.fn())
const writeOffChargeMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({
  getClientLedger: getClientLedgerMock,
  proposeAllocation: proposeAllocationMock,
  recordPayment: recordPaymentMock,
  writeOffCharge: writeOffChargeMock,
}))
```

(Move this above the existing `vi.mock('./api', ...)` call and merge into one — Vitest only honors the last `vi.mock` for a given module path, so Task 13's mock must be replaced, not duplicated, with this fuller one.)

```tsx
import userEvent from '@testing-library/user-event'

// ... inside describe('ClientLedgerSection', ...):

it('records a payment through the propose-then-confirm flow', async () => {
  getClientLedgerMock.mockResolvedValue({ entries: [], balanceCents: 0 })
  proposeAllocationMock.mockResolvedValue({ proposed: [{ chargeId: 'charge-1', amountCents: 9000 }], excessCents: 0 })
  recordPaymentMock.mockResolvedValue({ paymentId: 'p1' })
  renderSection()

  await userEvent.type(await screen.findByLabelText(/valor \(cêntimos\)/i), '9000')
  await userEvent.type(screen.getByLabelText(/data de receção/i), '2026-09-03')
  await userEvent.click(screen.getByRole('button', { name: /propor alocação/i }))

  expect(await screen.findByText(/9000/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /confirmar/i }))

  expect(recordPaymentMock).toHaveBeenCalledWith(
    expect.objectContaining({ amountCents: 9000, allocations: [{ chargeId: 'charge-1', amountCents: 9000 }] }),
  )
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- ClientLedgerSection`
Expected: FAIL — no "Registar pagamento" form exists yet to interact with.

- [ ] **Step 3: Implement `RecordPaymentForm`**

`apps/web/src/billing/RecordPaymentForm.tsx`:

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PAYMENT_METHOD_VALUES } from '@ledger-hq/domain'
import type { PaymentMethod } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatCurrency } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { proposeAllocation, recordPayment } from './api'
import type { ProposedAllocation } from './api'

type Props = { clientId: string; onRecorded: () => void }

export function RecordPaymentForm({ clientId, onRecorded }: Props) {
  const { t, i18n } = useTranslation(['billing', 'domain', 'common'])
  const [amountCents, setAmountCents] = useState('')
  const [receivedOn, setReceivedOn] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('TRANSFER')
  const [proposal, setProposal] = useState<{ proposed: ProposedAllocation[]; excessCents: number } | null>(null)

  const propose = useMutation({
    mutationFn: () => proposeAllocation(clientId, Number(amountCents)),
    onSuccess: (result) => setProposal(result),
  })

  const confirm = useMutation({
    mutationFn: () =>
      recordPayment({
        clientId,
        amountCents: Number(amountCents),
        receivedOn,
        method,
        allocations: proposal?.proposed ?? [],
      }),
    onSuccess: () => {
      setAmountCents('')
      setReceivedOn('')
      setProposal(null)
      onRecorded()
    },
  })

  return (
    <div className="flex max-w-sm flex-col gap-3">
      <h3 className="font-medium">{t('billing:payment.recordTitle')}</h3>

      <label className="flex flex-col gap-1 text-sm">
        {t('billing:payment.amountCents.label')}
        <input
          type="number"
          required
          min={1}
          value={amountCents}
          onChange={(event) => setAmountCents(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('billing:payment.receivedOn.label')}
        <input
          type="date"
          required
          value={receivedOn}
          onChange={(event) => setReceivedOn(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('billing:payment.method.label')}
        <select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)} className="rounded border border-slate-300 px-2 py-1">
          {PAYMENT_METHOD_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`domain:paymentMethod.${value}`)}
            </option>
          ))}
        </select>
      </label>

      <ErrorMessage error={propose.error} />

      {proposal === null ? (
        <button
          type="button"
          onClick={() => propose.mutate()}
          disabled={propose.isPending || amountCents === '' || receivedOn === ''}
          className="self-start rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {t('billing:payment.propose')}
        </button>
      ) : (
        <>
          <ul className="flex flex-col gap-1 rounded border border-slate-200 p-2 text-sm">
            {proposal.proposed.map((allocation) => (
              <li key={allocation.chargeId} className="flex items-center justify-between">
                <span>{allocation.chargeId}</span>
                <span>{formatCurrency(allocation.amountCents, i18n.language as SupportedLocale)}</span>
              </li>
            ))}
          </ul>
          {proposal.excessCents > 0 && (
            <p className="text-xs text-slate-600">
              {t('billing:payment.excess', { amount: formatCurrency(proposal.excessCents, i18n.language as SupportedLocale) })}
            </p>
          )}
          <ErrorMessage error={confirm.error} />
          <button
            type="button"
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending}
            className="self-start rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {t('billing:payment.confirm')}
          </button>
        </>
      )}
    </div>
  )
}
```

The proposal table renders each allocation's raw `chargeId`, not a human-readable description — a real "redistribute the proposed amounts before confirming" editing UI (the design doc's "confirms or redistributes," §3.2) is out of this task's scope; recorded here as an explicit gap for a follow-up rather than silently shipped as if it were the full picture, the same honesty Phase 2 used for its own "Owner review required" flags.

- [ ] **Step 4: Wire `RecordPaymentForm` and the current-plan query into `ClientLedgerSection`**

Modify `apps/web/src/billing/ClientLedgerSection.tsx`: fetch the client's current plan status from the ledger data isn't available (the ledger view has no plan info), so add a second query for it. Since Task 9's controller has no dedicated "get current plan" endpoint, derive it client-side from `getCurrentMonth()` (Task 11) filtered to this `clientId` — acceptable because `ClientLedgerSection` is a per-client view already paying the cost of several small queries, and a single-purpose "get one plan" endpoint would duplicate `getCurrentMonth`'s own query for one field. Add:

```tsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatCurrency } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { getClientLedger, writeOffCharge } from './api'
import { RecordPaymentForm } from './RecordPaymentForm'
import { RetainerPlanForm } from './RetainerPlanForm'
```

Replace the section's body so it renders `RecordPaymentForm` and a write-off button per outstanding charge; check the ledger entries against `charge_balances`-derived state isn't directly available from `getClientLedger` either (it returns chronological entries, not per-charge IDs to write off against) — for this task, wire write-off from the same information the ledger already has by extending `LedgerEntry` (Task 8) with an optional `chargeId: string | null` field (null for `PAYMENT` entries), so a `CHARGE` entry's row can carry a "write off" button without a second query. Update Task 8's `getClientLedger` return type and implementation retroactively is out of scope for this task to redo — instead, add the field now:

In `apps/api/src/billing/billing.service.ts`'s `getClientLedger`, extend the `LedgerEntry`-shaped object with `chargeId: charge.id` on `CHARGE` events and `chargeId: null` on `PAYMENT` events, and update the return type signature accordingly. Update `apps/web/src/billing/api.ts`'s `LedgerEntry` type to match (`chargeId: string | null`).

Then in `ClientLedgerSection.tsx`, add a small inline write-off control — a text input plus a button, one per `CHARGE` entry, kept open only for the entry currently being written off (`writingOffChargeId: string | null` state), matching the rest of the app's convention of an inline form rather than a browser `prompt()`:

```tsx
  const [writingOffChargeId, setWritingOffChargeId] = useState<string | null>(null)
  const [writeOffReason, setWriteOffReason] = useState('')

  const writeOff = useMutation({
    mutationFn: () => writeOffCharge(writingOffChargeId!, writeOffReason),
    onSuccess: () => {
      setWritingOffChargeId(null)
      setWriteOffReason('')
      invalidate()
    },
  })
```

and render, next to each `CHARGE` entry (this task's ledger view has no per-entry outstanding balance to gate the button on — offering write-off on an already-settled charge and letting the server apply it is a harmless no-op status flip, not a data-integrity risk, since `writtenOffAt`/`writeOffReason` simply get overwritten):

```tsx
                {entry.type === 'CHARGE' && entry.chargeId !== null && (
                  writingOffChargeId === entry.chargeId ? (
                    <span className="flex items-center gap-1">
                      <input
                        value={writeOffReason}
                        onChange={(event) => setWriteOffReason(event.target.value)}
                        placeholder={t('billing:writeOff.reason.label')}
                        className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                      />
                      <button type="button" onClick={() => writeOff.mutate()} disabled={writeOffReason.trim() === '' || writeOff.isPending} className="text-xs text-red-700 underline disabled:opacity-50">
                        {t('common:actions.save')}
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setWritingOffChargeId(entry.chargeId)} className="text-xs text-red-700 underline">
                      {t('billing:writeOff.action')}
                    </button>
                  )
                )}
```

Add `<ErrorMessage error={writeOff.error} />` and `<RecordPaymentForm clientId={clientId} onRecorded={invalidate} />` after the ledger list.

- [ ] **Step 5: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/api test -- billing.service && pnpm --filter @ledger-hq/api test:integration -- billing.integration && pnpm --filter @ledger-hq/web test -- ClientLedgerSection`
Expected: PASS — confirm Task 8's `getClientLedger` tests still pass with the added `chargeId` field (they use `expect.objectContaining`, so the extra field doesn't break them; if any assertion uses `toEqual` instead, update it to include `chargeId`).

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/api typecheck && pnpm --filter @ledger-hq/api lint && pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/billing/RecordPaymentForm.tsx apps/web/src/billing/ClientLedgerSection.tsx \
  apps/web/src/billing/ClientLedgerSection.test.tsx apps/web/src/billing/api.ts \
  apps/api/src/billing/billing.service.ts apps/api/test/billing.integration.test.ts
git commit -m "feat(web): add payment recording (propose/confirm) and write-off"
```

---

### Task 15: Wire the real current plan into `RetainerPlanForm` — enabling the renew path

**Files:**
- Modify: `apps/web/src/billing/ClientLedgerSection.tsx`
- Modify: `apps/web/src/billing/ClientLedgerSection.test.tsx`

**Interfaces:**
- Consumes: `getCurrentMonth` (Task 11) — the only endpoint that already returns which clients have an in-force plan, filtered client-side to this one `clientId`, per Task 14's own note that a dedicated "get one plan" endpoint would duplicate it for one field.
- Produces: `ClientLedgerSection`'s `<RetainerPlanForm currentPlan={...}>` now receives a real plan when one exists, activating the renew form path Task 13 wrote but never exercised (it always passed `null`).

`getCurrentMonth`'s row (`{ clientId, clientName, paid, outstandingCents }`) does not carry the full `RetainerPlan` shape `RetainerPlanForm` needs (`amountCents`, `periodicity`, `dueDayOfMonth`) — only whether one exists for this client at all. This task adds a minimal, dedicated `getCurrentRetainerPlan(clientId)` to `apps/web/src/billing/api.ts` and a matching `GET /billing/clients/:clientId/retainer-plan` route, rather than stretching `getCurrentMonth` further — the "don't duplicate a query for one field" reasoning in Task 14 applied to reusing an *existing* endpoint for an unrelated purpose; it does not extend to skipping a small, correctly-shaped one now that the actual need (the plan's own fields, not just its existence) is concrete.

- [ ] **Step 1: Write the backend test for the new route**

Add to `apps/api/test/billing.integration.test.ts`:

```ts
describe('GET /billing/clients/:clientId/retainer-plan', () => {
  it('returns the in-force plan', async () => {
    const clientId = await createClient('600000020')
    await post(`/api/v1/billing/clients/${clientId}/retainer-plan`, { amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-01-01' })

    const response = await get(`/api/v1/billing/clients/${clientId}/retainer-plan`)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ clientId, amountCents: 9000 })
  })

  it('returns null for a client with no plan', async () => {
    const clientId = await createClient('600000021')

    const response = await get(`/api/v1/billing/clients/${clientId}/retainer-plan`)

    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/api test:integration -- billing.integration`
Expected: FAIL — 404, the route doesn't exist.

- [ ] **Step 3: Add the service method and route**

Add to `billing.service.ts`, after `renewRetainerPlan`:

```ts
  async getCurrentRetainerPlan(clientId: string): Promise<RetainerPlan | null> {
    return this.prisma.retainerPlan.findFirst({ where: { clientId, validTo: null } })
  }
```

Add to `billing.controller.ts`, after `renewRetainerPlan`:

```ts
  @Get('clients/:clientId/retainer-plan')
  async getCurrentRetainerPlan(@Param('clientId') clientId: string) {
    return this.billing.getCurrentRetainerPlan(clientId)
  }
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/api test:integration -- billing.integration`
Expected: PASS.

- [ ] **Step 5: Add the web client function and test**

Add to `apps/web/src/billing/api.ts`:

```ts
export function getCurrentRetainerPlan(clientId: string): Promise<RetainerPlan | null> {
  return apiFetch(`/billing/clients/${clientId}/retainer-plan`)
}
```

Add to `apps/web/src/billing/ClientLedgerSection.test.tsx`'s mocked `./api` module: `getCurrentRetainerPlan: getCurrentRetainerPlanMock` (a new `vi.hoisted(() => vi.fn())`), and a test:

```tsx
it('shows the renew form, not the create form, when a plan is already in force', async () => {
  getClientLedgerMock.mockResolvedValue({ entries: [], balanceCents: 0 })
  getCurrentRetainerPlanMock.mockResolvedValue({ id: 'plan-1', clientId: 'c1', amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-01-01', validTo: null })
  renderSection()

  await userEvent.click(await screen.findByRole('button', { name: /^editar$/i }))

  expect(await screen.findByText(/atualizar valor/i)).toBeInTheDocument()
  expect(screen.queryByText(/criar plano de retainer/i)).not.toBeInTheDocument()
})
```

- [ ] **Step 6: Wire it into `ClientLedgerSection`**

Replace `<RetainerPlanForm currentPlan={null} ...>` with a real query:

```tsx
  const currentPlan = useQuery({ queryKey: ['current-retainer-plan', clientId], queryFn: () => getCurrentRetainerPlan(clientId) })
```

```tsx
      {showPlanForm && currentPlan.data !== undefined && (
        <RetainerPlanForm
          clientId={clientId}
          currentPlan={currentPlan.data}
          onSaved={() => {
            setShowPlanForm(false)
            invalidate()
            queryClient.invalidateQueries({ queryKey: ['current-retainer-plan', clientId] })
          }}
        />
      )}
```

- [ ] **Step 7: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- ClientLedgerSection`
Expected: PASS, including the new renew-form test.

- [ ] **Step 8: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/api typecheck && pnpm --filter @ledger-hq/api lint && pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/billing/billing.service.ts apps/api/src/billing/billing.controller.ts apps/api/test/billing.integration.test.ts \
  apps/web/src/billing/api.ts apps/web/src/billing/ClientLedgerSection.tsx apps/web/src/billing/ClientLedgerSection.test.tsx
git commit -m "feat: wire the real current retainer plan into the renew form"
```

---

### Task 16: `AddAdHocChargeForm` — creating a charge outside any plan

**Files:**
- Create: `apps/web/src/billing/AddAdHocChargeForm.tsx`
- Modify: `apps/web/src/billing/ClientLedgerSection.tsx`
- Modify: `apps/web/src/billing/ClientLedgerSection.test.tsx`

**Interfaces:**
- Consumes: `createAdHocCharge` (Task 11).
- Produces: `AddAdHocChargeForm`, rendered inside `ClientLedgerSection` alongside the existing ledger list and payment form — same "fixed form at the bottom of the section, always visible" placement Phase 2's `AddAdHocObligationForm` established for the analogous EXTRA-work case (design doc §3.6).

- [ ] **Step 1: Add the test**

Add to `apps/web/src/billing/ClientLedgerSection.test.tsx`:

```tsx
const createAdHocChargeMock = vi.hoisted(() => vi.fn())
// add createAdHocCharge: createAdHocChargeMock to the vi.mock('./api', ...) call

it('creates an ad-hoc charge', async () => {
  getClientLedgerMock.mockResolvedValue({ entries: [], balanceCents: 0 })
  getCurrentRetainerPlanMock.mockResolvedValue(null)
  createAdHocChargeMock.mockResolvedValue({ id: 'charge-1' })
  renderSection()

  await userEvent.type(await screen.findByLabelText(/descrição/i), 'Consultoria extra')
  await userEvent.type(screen.getByLabelText(/valor \(cêntimos\)/i, { selector: 'input' }), '15000')
  await userEvent.type(screen.getByLabelText(/data de vencimento/i), '2026-10-01')
  await userEvent.click(screen.getByRole('button', { name: /^criar$/i }))

  expect(createAdHocChargeMock).toHaveBeenCalledWith({ clientId: 'c1', description: 'Consultoria extra', amountCents: 15000, dueOn: '2026-10-01' })
})
```

`getByLabelText(/valor \(cêntimos\)/i, { selector: 'input' })` disambiguates from `RecordPaymentForm`'s own "Valor (cêntimos)" field — both forms are always rendered together in this section, the same "two fields with the same label coexist by design" situation Phase 2's `AddAdHocObligationForm`/`AdjustObligationForm` hit with "Prazo," resolved there by scoping the query rather than renaming either label.

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- ClientLedgerSection`
Expected: FAIL — no ad-hoc charge form exists yet.

- [ ] **Step 3: Implement `AddAdHocChargeForm`**

`apps/web/src/billing/AddAdHocChargeForm.tsx`:

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { createAdHocCharge } from './api'

type Props = { clientId: string; onCreated: () => void }

export function AddAdHocChargeForm({ clientId, onCreated }: Props) {
  const { t } = useTranslation(['billing', 'common'])
  const [description, setDescription] = useState('')
  const [amountCents, setAmountCents] = useState('')
  const [dueOn, setDueOn] = useState('')

  const mutation = useMutation({
    mutationFn: () => createAdHocCharge({ clientId, description, amountCents: Number(amountCents), dueOn }),
    onSuccess: () => {
      setDescription('')
      setAmountCents('')
      setDueOn('')
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
      <h3 className="font-medium">{t('billing:adHocCharge.newTitle')}</h3>

      <label className="flex flex-col gap-1 text-sm">
        {t('billing:adHocCharge.description.label')}
        <input required value={description} onChange={(event) => setDescription(event.target.value)} className="rounded border border-slate-300 px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('billing:adHocCharge.amountCents.label')}
        <input
          type="number"
          required
          min={1}
          value={amountCents}
          onChange={(event) => setAmountCents(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('billing:adHocCharge.dueOn.label')}
        <input type="date" required value={dueOn} onChange={(event) => setDueOn(event.target.value)} className="rounded border border-slate-300 px-2 py-1" />
      </label>

      <ErrorMessage error={mutation.error} />

      <button type="submit" disabled={mutation.isPending} className="self-start rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50">
        {t('common:actions.create')}
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Wire it into `ClientLedgerSection`**

Add the import and render `<AddAdHocChargeForm clientId={clientId} onCreated={invalidate} />` after `RecordPaymentForm`.

- [ ] **Step 5: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- ClientLedgerSection && pnpm --filter @ledger-hq/web test`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/billing/AddAdHocChargeForm.tsx apps/web/src/billing/ClientLedgerSection.tsx apps/web/src/billing/ClientLedgerSection.test.tsx
git commit -m "feat(web): add ad-hoc charge creation"
```

---

### Task 17: End-to-end billing test

**Files:**
- Create: `apps/web/e2e/billing.spec.ts`

**Interfaces:**
- Consumes: the whole billing UI (Tasks 11-16), exercised end-to-end.
- Produces: the create-plan → generate → pay → receivables flow, proving the pieces built in isolation compose into the feature the master spec and design doc describe — same role Phase 2's `obligations.spec.ts` played for that phase.

Phase 2's own Task 18 found and fixed two real cross-spec collisions the hard way (a bootstrap-order race, and a duplicated "Designação"/"Criar" label from a form that renders on every client page) — both fixes are already in place on `master` by the time this task starts. This task's own job is to not introduce a third: `ClientLedgerSection`'s always-rendered `RecordPaymentForm`/`AddAdHocChargeForm` both have their own "Valor (cêntimos)" fields, and `RecordPaymentForm`'s "Confirmar" button sits near `AddAdHocChargeForm`'s "Criar" — scope every locator in this spec the same deliberate way `obligations.spec.ts` and `vault-offline.spec.ts` already had to.

- [ ] **Step 1: Write the test**

`apps/web/e2e/billing.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

const MASTER_PASSWORD = 'a sufficiently long master password'

test('creates a retainer plan, generates a charge, records a payment, and sees the client clear from receivables', async ({ page }) => {
  await page.goto('/')

  // Bootstrap-or-sign-in fallback, same idiom as every other spec in this
  // suite (see obligations.spec.ts's own comment for why this can't assume
  // it always wins the single-account bootstrap race).
  await page.getByLabel(/email/i).fill('paulo@example.com')
  await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
  const confirmPasswordField = page.getByLabel(/confirma/i)
  if (await confirmPasswordField.isVisible().catch(() => false)) {
    await confirmPasswordField.fill(MASTER_PASSWORD)
  }
  await page.getByRole('button', { name: /criar|entrar/i }).click()
  await expect(page.getByRole('link', { name: /clientes/i })).toBeVisible()

  // A distinct NIF from every other spec's own client, to avoid a 409 when
  // the full suite runs together.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Padaria Central Faturação, Lda.')
  await page.getByLabel(/^nif$/i).fill('501442634')
  await page.getByRole('button', { name: /guardar/i }).click()
  await expect(page.getByText('Padaria Central Faturação, Lda.')).toBeVisible()
  await page.getByRole('button', { name: /guardar/i }).click() // fiscal profile defaults

  // Create the retainer plan. The billing ledger section's own "Editar"
  // button toggles the create/renew form — scope to the ledger section's
  // own heading to avoid the client page's other "Editar" buttons
  // (obligations' AdjustObligationForm toggle).
  const ledgerSection = page.locator('section', { has: page.getByRole('heading', { name: /faturação/i }) })
  await ledgerSection.getByRole('button', { name: /^editar$/i }).click()
  await page.getByLabel(/valor mensal/i).fill('9000')
  await page.getByLabel(/dia de vencimento/i).fill('8')
  await page.getByLabel(/em vigor desde/i).fill('2026-01-01')
  await ledgerSection.getByRole('button', { name: /guardar/i }).click()
  await expect(page.getByText(/atualizar valor/i)).not.toBeVisible()

  // Generate charges for this client via the dashboard-adjacent flow isn't
  // exposed per-client in the UI (only the global cron and the raw
  // generate-charges endpoint apply retroactively) — the home page's
  // receivables section only reflects *already-generated* charges, so
  // record a payment against a manually-created ad-hoc charge instead,
  // which exercises the exact same propose/confirm/write-off code paths
  // without depending on the daily cron having run in this test's window.
  await page.getByLabel(/^descrição$/i).fill('Consultoria extra')
  await ledgerSection.getByLabel(/valor \(cêntimos\)/i).nth(1).fill('15000')
  await page.getByLabel(/data de vencimento/i).fill('2026-10-01')
  await ledgerSection.getByRole('button', { name: /^criar$/i }).click()

  // Record a payment covering it in full.
  await ledgerSection.getByLabel(/valor \(cêntimos\)/i).first().fill('15000')
  await page.getByLabel(/data de receção/i).fill('2026-10-05')
  await page.getByRole('button', { name: /propor alocação/i }).click()
  await expect(page.getByText(/15.*€|€.*15/)).toBeVisible()
  await page.getByRole('button', { name: /confirmar/i }).click()

  // The ledger now shows the charge and the payment, net balance zero.
  await expect(page.getByText(/consultoria extra/i)).toBeVisible()
  await expect(ledgerSection.getByText(/saldo/i)).toBeVisible()

  // Back on the home page, this client no longer appears in receivables —
  // the charge is fully allocated.
  await page.goto('/')
  await expect(page.getByText(/padaria central faturação/i)).not.toBeVisible()
})
```

- [ ] **Step 2: Run it against the real backend**

```bash
pnpm --filter @ledger-hq/web build
pnpm --filter @ledger-hq/web test:e2e -- billing
```

Expected: PASS. If a locator resolves ambiguously (this section deliberately renders three forms with overlapping field labels — "Valor (cêntimos)" appears in both `RecordPaymentForm` and `AddAdHocChargeForm`), scope it the same way this spec's own `.nth(1)`/`.first()` calls already do, rather than loosening the assertion.

- [ ] **Step 3: Run the full e2e suite**

Run: `pnpm --filter @ledger-hq/web test:e2e`
Expected: everything green — confirm this new spec doesn't collide with any of the four Phase 1/2 specs, the same check Phase 2's Task 18 had to redo twice after finding real collisions.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/billing.spec.ts
git commit -m "test(web): add the end-to-end billing flow (plan, charge, payment)"
```

---

### Task 18: Documentation

**Files:**
- Create: `docs/adr/0007-billing-generator-and-view.md`
- Modify: `README.md` (phase-status paragraph, same as Phase 2's Task 19)

**Interfaces:** none — this task changes no code.

Unlike the obligation catalog, billing introduces no product-owner-reviewable data table — the ADR here instead records the two structural decisions this plan made that the master spec's prose didn't fully pin down: the `charge_balances` view's `::int` casting discipline, and why the charge generator has no retraction step (unlike the obligation generator it otherwise mirrors).

- [ ] **Step 1: Confirm the next ADR number**

Run: `ls docs/adr/` — the highest existing number as of this plan's authoring is `0006` (Phase 2's own ADR), so this is `0007`.

- [ ] **Step 2: Write the ADR**

`docs/adr/0007-billing-generator-and-view.md`:

```markdown
# 7. Billing: no retraction, and an explicit `::int` cast discipline

- **Date:** (fill in on the day this task actually runs)
- **Status:** Accepted

## Context

Phase 3 mirrors Phase 2's obligation-engine shape (generator, resolver,
read views) for billing, per the design doc
(`docs/superpowers/specs/2026-09-17-phase-3-billing-design.md`). Two
decisions came up during implementation that the master spec's prose
(§6.6, §8) doesn't fully resolve on its own.

## Decision 1: the charge generator has no retraction step

The obligation generator (Phase 2) retracts a `PENDING` instance whose rule
no longer applies, guarded so it never touches a period that has already
ended (a real bug, found and fixed during Phase 2's Task 10 review — see
that phase's own ledger). Billing's `generateCharges` has no equivalent
step at all: once a `RetainerPlan` closes, `chargePeriodsSince` simply stops
producing periods past its `validTo`, and every charge already created for
an earlier period is real, already-issued debt that must never disappear
merely because the plan later closed. There is nothing to retract — the
generator's only job is creating what's missing, never removing what
exists.

## Decision 2: every raw-SQL aggregate is cast `::int` explicitly

Postgres's `SUM()`/`COUNT()` over an `Int` column returns `bigint`.
`prisma.$queryRaw` hands that back as a JS `bigint`, which NestJS's default
JSON serializer throws on. The `charge_balances` view casts every aggregate
at its source (`COALESCE(SUM(...), 0)::int`), so every consumer — the
receivables and current-month queries built on top of it — inherits a
plain, JSON-safe `number` without needing to remember the cast itself.
Discovered and fixed during this plan's own authoring (see the Global
Constraints section of the implementation plan), not left for a runtime
500 to surface it.

## Consequences

A future feature that needs to know *why* a charge stopped being generated
(distinct from a charge that simply hasn't been created yet) would need a
new signal — nothing in this schema currently distinguishes "plan closed
before this period" from "plan never existed for this period." Not needed
by anything in this phase's scope; worth remembering if raised later.
```

- [ ] **Step 3: Update the README's phase-status paragraph**

Add "Phase 3 — Billing" (retainer plans, charge generation, payment recording with FIFO allocation, receivables) alongside Phases 0-2, following the same edit Phase 2's Task 19 made to the same paragraph.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0007-billing-generator-and-view.md README.md
git commit -m "docs: record the billing generator and view decisions this phase made"
```

---

## Final review

Once all 18 tasks are complete and individually reviewed: a final whole-branch review (the most capable available model, per this repo's established SDD process — see Phase 1 and Phase 2's own closing steps), then `superpowers:finishing-a-development-branch` to decide what happens to the branch.

