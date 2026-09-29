# Phase 4a — Client Credit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unallocated payment excess spendable — derived as credit, netted into the receivables views, and consumable both when charges are generated and on demand from the client ledger.

**Architecture:** Credit is never stored. A `payment_credits` SQL view derives it per payment exactly as `charge_balances` derives outstanding debt per charge. The pure `proposeAllocation` function in `packages/domain` stops taking a bare amount and starts taking allocation *sources*, so one proposal can draw on several earlier payments; FIFO now runs in two dimensions (charges by `dueOn`, sources by `receivedOn`). Money only ever moves through a confirmed proposal — the receivables netting is notional and writes nothing.

**Tech Stack:** TypeScript (ESM), NestJS 12, Prisma 7 + PostgreSQL 18, Zod, Vitest, Testcontainers, React 19 + TanStack Query/Router, Tailwind, i18next, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-phase-4a-client-credit-design.md`

## Global Constraints

- Node 24, pnpm 11, ESM everywhere. Relative imports inside `apps/api` carry the `.js` extension; imports from `@ledger-hq/domain` do not.
- ADR 0007: **every** raw-SQL `SUM`/`COUNT` carries its own `::int` cast. A `SUM` over an already-cast `int` column is a fresh `bigint`, and a missed cast fails at response serialization, not at migration time.
- ADR 0004 / master spec §10.3: the backend emits error codes, never prose. New codes go in `packages/domain/src/errors.ts`.
- Prisma does not model views. `payment_credits` is read through `$queryRaw` with an explicit row type, exactly as `charge_balances` is read today.
- Every new user-facing string needs a key in both `apps/web/src/i18n/locales/pt/` and `apps/web/src/i18n/locales/en/`. `pnpm --filter @ledger-hq/web i18n:check` fails on any key present in one locale and missing in the other.
- Currency is never formatted by hand: the API sends `Int` cents, the web app renders them through the `Money` component or `formatCurrency`.
- `validFrom`/`validTo`/`dueOn`/`receivedOn` are `DATE` columns. Compare them against dates, never timestamps, and send them over the wire through `isoDate()`.
- After every task: `pnpm lint && pnpm typecheck && pnpm test` must pass before the commit.

## Review Focus

Five conditions the spec implies that no single feature test would otherwise reach. Each is pinned to a test in the task that owns the code.

1. **Credit exceeds total debt.** The net figure floors at zero and the client leaves the receivables list entirely — never a negative amount in the list or in the home page's outstanding tile. (Task 6)
2. **Two writes drawing the same credit at once** — an `apply-credit` confirm racing a `record-payment` confirm against the same client. The `Payment` row lock must stop the same cents being spent twice. (Task 4)
3. **Credit with nothing due yet.** A client holding credit whose only charge falls due next month: `apply-credit` proposes nothing, returns the full credit as remaining, and does not error or reach forward to a charge that has not fallen due. (Task 4)
4. **Written-off charges never absorb credit.** A forgiven debt must not quietly swallow money the client can still spend. (Task 4)
5. **A payment allocated to the last cent** reports `creditCents` exactly `0`, and the client ledger hides the Apply-credit action rather than offering an action that would propose nothing. (Tasks 3 and 8)

---

### Task 1: `proposeAllocation` takes allocation sources

**Files:**
- Modify: `packages/domain/src/billing/types.ts:23`
- Modify: `packages/domain/src/billing/allocate.ts:1-25`
- Modify: `packages/domain/src/billing/allocate.test.ts`
- Modify: `apps/api/src/billing/billing.service.ts:170-200` (the one existing caller)

**Interfaces:**
- Consumes: `ChargeBalance` from `packages/domain/src/billing/types.ts` (unchanged).
- Produces:
  ```ts
  export type AllocationSource = { paymentId: string | null; availableCents: number; receivedOn: Date }
  export type ProposedAllocation = { paymentId: string | null; chargeId: string; amountCents: number }
  export function proposeAllocation(sources: AllocationSource[], openCharges: ChargeBalance[]): ProposedAllocation[]
  ```
  `paymentId: null` means "the payment being recorded in this same request", which has no id yet because `recordPayment` mints it inside its own transaction. Every source in an `apply-credit` proposal carries a real id; the single source in a `record-payment` proposal carries `null`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/domain/src/billing/allocate.test.ts`, keeping the existing `openCharge` helper, and add a second helper beside it:

```ts
function source(overrides: { paymentId?: string | null; availableCents: number; receivedOn: string }): AllocationSource {
  return {
    paymentId: overrides.paymentId ?? null,
    availableCents: overrides.availableCents,
    receivedOn: new Date(`${overrides.receivedOn}T00:00:00Z`),
  }
}
```

Import the type: `import type { AllocationSource, ChargeBalance } from './types'`.

```ts
describe('proposeAllocation with several sources', () => {
  it('spends the oldest source first', () => {
    const charges = [openCharge({ id: 'jan', dueOn: '2026-01-08', outstandingCents: 9000 })]
    const sources = [
      source({ paymentId: 'newer', availableCents: 9000, receivedOn: '2026-03-01' }),
      source({ paymentId: 'older', availableCents: 9000, receivedOn: '2026-02-01' }),
    ]
    expect(proposeAllocation(sources, charges)).toEqual([{ paymentId: 'older', chargeId: 'jan', amountCents: 9000 }])
  })

  it('splits one charge across two sources when neither covers it alone', () => {
    const charges = [openCharge({ id: 'jan', dueOn: '2026-01-08', outstandingCents: 9000 })]
    const sources = [
      source({ paymentId: 'a', availableCents: 4000, receivedOn: '2026-02-01' }),
      source({ paymentId: 'b', availableCents: 8000, receivedOn: '2026-03-01' }),
    ]
    expect(proposeAllocation(sources, charges)).toEqual([
      { paymentId: 'a', chargeId: 'jan', amountCents: 4000 },
      { paymentId: 'b', chargeId: 'jan', amountCents: 5000 },
    ])
  })

  it('spends one source across several charges, oldest charge first', () => {
    const charges = [
      openCharge({ id: 'feb', dueOn: '2026-02-08', outstandingCents: 9000 }),
      openCharge({ id: 'jan', dueOn: '2026-01-08', outstandingCents: 9000 }),
    ]
    const sources = [source({ paymentId: 'a', availableCents: 15000, receivedOn: '2026-01-01' })]
    expect(proposeAllocation(sources, charges)).toEqual([
      { paymentId: 'a', chargeId: 'jan', amountCents: 9000 },
      { paymentId: 'a', chargeId: 'feb', amountCents: 6000 },
    ])
  })

  it('skips a source with nothing left on it', () => {
    const charges = [openCharge({ id: 'jan', dueOn: '2026-01-08', outstandingCents: 9000 })]
    const sources = [
      source({ paymentId: 'spent', availableCents: 0, receivedOn: '2026-01-01' }),
      source({ paymentId: 'live', availableCents: 9000, receivedOn: '2026-02-01' }),
    ]
    expect(proposeAllocation(sources, charges)).toEqual([{ paymentId: 'live', chargeId: 'jan', amountCents: 9000 }])
  })

  it('proposes nothing when there are no sources', () => {
    const charges = [openCharge({ id: 'jan', dueOn: '2026-01-08', outstandingCents: 9000 })]
    expect(proposeAllocation([], charges)).toEqual([])
  })

  it('never draws more from a source than it has available', () => {
    const charges = [
      openCharge({ id: 'jan', dueOn: '2026-01-08', outstandingCents: 50000 }),
      openCharge({ id: 'feb', dueOn: '2026-02-08', outstandingCents: 50000 }),
    ]
    const sources = [
      source({ paymentId: 'a', availableCents: 12345, receivedOn: '2026-01-01' }),
      source({ paymentId: 'b', availableCents: 6789, receivedOn: '2026-01-02' }),
    ]
    const drawn = new Map<string | null, number>()
    for (const allocation of proposeAllocation(sources, charges)) {
      drawn.set(allocation.paymentId, (drawn.get(allocation.paymentId) ?? 0) + allocation.amountCents)
    }
    expect(drawn.get('a')).toBe(12345)
    expect(drawn.get('b')).toBe(6789)
  })
})
```

Then rewrite every existing call in that file from `proposeAllocation(9000, charges)` to
`proposeAllocation([source({ availableCents: 9000, receivedOn: '2026-01-01' })], charges)`, and change each
expectation from `{ chargeId: 'a', amountCents: 9000 }` to `{ paymentId: null, chargeId: 'a', amountCents: 9000 }`.
The existing property test that asserts allocations never exceed the payment keeps its meaning with one source.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @ledger-hq/domain test
```

Expected: FAIL. The new tests fail on the signature (a number is not an array); the rewritten old tests fail on the missing `paymentId` in the result.

- [ ] **Step 3: Widen the types**

In `packages/domain/src/billing/types.ts`, replace the final line:

```ts
/**
 * `paymentId` is `null` for the payment being recorded in the same request,
 * which has no id until `recordPayment`'s transaction mints one. Every
 * source drawn from existing credit carries a real id.
 */
export type ProposedAllocation = { paymentId: string | null; chargeId: string; amountCents: number }

/**
 * Money available to allocate. `availableCents` is a row of the
 * `payment_credits` view (`creditCents`) for existing credit, or the full
 * amount of the payment being recorded right now.
 */
export type AllocationSource = { paymentId: string | null; availableCents: number; receivedOn: Date }
```

- [ ] **Step 4: Rewrite the allocator**

Replace the body of `packages/domain/src/billing/allocate.ts`:

```ts
import type { AllocationSource, ChargeBalance, ProposedAllocation } from './types'

/**
 * FIFO allocation across a client's open charges, oldest due date first
 * (master spec §8.2), drawing on one or more sources, oldest received first
 * (Phase 4a design §4.2) — so the oldest credit is spent before newer credit.
 * Never mutates its input; never allocates more than a charge's own
 * outstanding balance, and never draws more from a source than that source
 * has available. The caller — never this function — decides whether to apply
 * the proposal as-is or let the accountant redistribute it first.
 */
export function proposeAllocation(sources: AllocationSource[], openCharges: ChargeBalance[]): ProposedAllocation[] {
  const charges = openCharges.filter((charge) => charge.outstandingCents > 0).sort((a, b) => a.dueOn.getTime() - b.dueOn.getTime())
  // Copied, not aliased: the loop below spends each source down, and a
  // caller's array must come back untouched.
  const funds = sources
    .filter((source) => source.availableCents > 0)
    .sort((a, b) => a.receivedOn.getTime() - b.receivedOn.getTime())
    .map((source) => ({ paymentId: source.paymentId, remainingCents: source.availableCents }))

  const allocations: ProposedAllocation[] = []
  let fundIndex = 0

  for (const charge of charges) {
    let remainingOnCharge = charge.outstandingCents

    while (remainingOnCharge > 0 && fundIndex < funds.length) {
      const fund = funds[fundIndex]!
      const amount = Math.min(remainingOnCharge, fund.remainingCents)
      allocations.push({ paymentId: fund.paymentId, chargeId: charge.id, amountCents: amount })
      fund.remainingCents -= amount
      remainingOnCharge -= amount
      if (fund.remainingCents === 0) fundIndex += 1
    }

    if (fundIndex >= funds.length) break
  }

  return allocations
}
```

- [ ] **Step 5: Run the domain tests**

```bash
pnpm --filter @ledger-hq/domain test
```

Expected: PASS, every test in `allocate.test.ts`.

- [ ] **Step 6: Fix the one existing caller so the build stays green**

In `apps/api/src/billing/billing.service.ts`, `proposeAllocationForClient` currently calls
`proposeAllocation(amountCents, openCharges)`. Replace that single line (around line 181) with:

```ts
    // One source: the payment being recorded now, which has no id yet.
    const proposed = proposeAllocation([{ paymentId: null, availableCents: amountCents, receivedOn: new Date() }], openCharges)
```

and, in the `rows` mapping just below it, add the field so the row type still matches `ProposedAllocation`:

```ts
      return {
        paymentId: allocation.paymentId,
        chargeId: allocation.chargeId,
        amountCents: allocation.amountCents,
        description: charge?.description ?? '',
        periodLabel: charge?.periodLabel ?? null,
        dueOn: charge ? isoDate(charge.dueOn) : null,
      }
```

`recordPayment` is untouched: its wire format still carries only `chargeId` and `amountCents`, because every allocation in that request is drawn from the payment it is recording.

- [ ] **Step 7: Run the whole suite**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS everywhere.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/billing apps/api/src/billing/billing.service.ts
git commit -m "feat(domain): allocate from sources, not a bare amount

proposeAllocation now takes AllocationSource[] so one proposal can draw
on several earlier payments. FIFO runs in two dimensions: charges by
dueOn, sources by receivedOn, so the oldest credit is spent first.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The `payment_credits` view

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp>_payment_credits/migration.sql`
- Test: `apps/api/test/schema-constraints.integration.test.ts`

**Interfaces:**
- Produces: a `payment_credits` view with columns `paymentId` (uuid), `clientId` (uuid), `receivedOn` (date), `amountCents` (int), `allocatedCents` (int), `creditCents` (int). Tasks 3–7 read it.

- [ ] **Step 1: Create the empty migration**

Prisma generates nothing on its own here — there is no schema change, only a view.

```bash
cd apps/api
set -a && . ./.env && set +a
pnpm exec prisma migrate dev --create-only --name payment_credits
```

This creates `apps/api/prisma/migrations/<timestamp>_payment_credits/migration.sql`, empty.

- [ ] **Step 2: Write the view**

Put this in that `migration.sql`:

```sql
-- Derived credit per payment: what was received, minus what has been
-- allocated to charges. Mirrors charge_balances (Phase 3) — credit is never
-- stored, so it cannot drift from the allocations that spend it.
-- Every aggregate carries its own ::int (ADR 0007): SUM() over an Int column
-- returns bigint, which the JSON serializer throws on.
CREATE VIEW payment_credits AS
SELECT
  p.id                                                       AS "paymentId",
  p."clientId",
  p."receivedOn",
  p."amountCents",
  COALESCE(SUM(a."amountCents"), 0)::int                      AS "allocatedCents",
  (p."amountCents" - COALESCE(SUM(a."amountCents"), 0))::int  AS "creditCents"
FROM "Payment" p
LEFT JOIN "PaymentAllocation" a ON a."paymentId" = p.id
GROUP BY p.id;
```

`GROUP BY p.id` alone is enough: `id` is the primary key, so Postgres accepts every other `p.` column as functionally dependent on it.

- [ ] **Step 3: Write the failing constraint test**

Append to `apps/api/test/schema-constraints.integration.test.ts`, following the file's existing style:

```ts
describe('payment_credits view', () => {
  it('reports the unallocated remainder as credit, as a JSON-safe number', async () => {
    const clientId = await createClient('501111111')
    const chargeId = uuidv7()
    await prisma.charge.create({
      data: {
        id: chargeId,
        clientId,
        kind: 'EXTRA',
        description: 'Ad-hoc',
        amountCents: 5000,
        issuedOn: new Date('2026-01-01T00:00:00Z'),
        dueOn: new Date('2026-01-31T00:00:00Z'),
      },
    })
    const paymentId = uuidv7()
    await prisma.payment.create({
      data: { id: paymentId, clientId, amountCents: 12000, receivedOn: new Date('2026-02-01T00:00:00Z'), method: 'TRANSFER' },
    })
    await prisma.paymentAllocation.create({ data: { paymentId, chargeId, amountCents: 5000 } })

    const [row] = await prisma.$queryRaw<Array<{ creditCents: number; allocatedCents: number }>>`
      SELECT "creditCents", "allocatedCents" FROM payment_credits WHERE "paymentId" = ${paymentId}::uuid
    `
    expect(row?.creditCents).toBe(7000)
    expect(row?.allocatedCents).toBe(5000)
    // ADR 0007: a missed ::int hands back a bigint and fails at
    // serialization, in the response, not here — so assert the type.
    expect(typeof row?.creditCents).toBe('number')
    expect(typeof row?.allocatedCents).toBe('number')
  })

  it('reports zero credit for a payment allocated to the last cent', async () => {
    const clientId = await createClient('501222222')
    const chargeId = uuidv7()
    await prisma.charge.create({
      data: {
        id: chargeId,
        clientId,
        kind: 'EXTRA',
        description: 'Ad-hoc',
        amountCents: 9000,
        issuedOn: new Date('2026-01-01T00:00:00Z'),
        dueOn: new Date('2026-01-31T00:00:00Z'),
      },
    })
    const paymentId = uuidv7()
    await prisma.payment.create({
      data: { id: paymentId, clientId, amountCents: 9000, receivedOn: new Date('2026-02-01T00:00:00Z'), method: 'TRANSFER' },
    })
    await prisma.paymentAllocation.create({ data: { paymentId, chargeId, amountCents: 9000 } })

    const [row] = await prisma.$queryRaw<Array<{ creditCents: number }>>`
      SELECT "creditCents" FROM payment_credits WHERE "paymentId" = ${paymentId}::uuid
    `
    expect(row?.creditCents).toBe(0)
  })

  it('reports the full amount as credit for a payment with no allocations', async () => {
    const clientId = await createClient('501333333')
    const paymentId = uuidv7()
    await prisma.payment.create({
      data: { id: paymentId, clientId, amountCents: 27000, receivedOn: new Date('2026-02-01T00:00:00Z'), method: 'TRANSFER' },
    })

    const [row] = await prisma.$queryRaw<Array<{ creditCents: number }>>`
      SELECT "creditCents" FROM payment_credits WHERE "paymentId" = ${paymentId}::uuid
    `
    expect(row?.creditCents).toBe(27000)
  })
})
```

If `schema-constraints.integration.test.ts` has no `createClient` helper of its own, copy the one from `apps/api/test/billing.integration.test.ts` verbatim into the file rather than importing it — the test files are self-contained by convention.

- [ ] **Step 4: Run the test to verify it fails**

```bash
pnpm --filter @ledger-hq/api test:integration -- schema-constraints
```

Expected: FAIL with a Postgres error, `relation "payment_credits" does not exist` — the migration has not been applied to the disposable container yet only if you skipped Step 1's `migrate dev`; if it was applied, the test passes immediately and you should instead verify by checking the migration file is present and re-running.

- [ ] **Step 5: Apply the migration and re-run**

```bash
cd apps/api
set -a && . ./.env && set +a
pnpm exec prisma migrate dev
cd ../..
pnpm --filter @ledger-hq/api test:integration -- schema-constraints
```

Expected: PASS, all three cases.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/migrations apps/api/test/schema-constraints.integration.test.ts
git commit -m "feat(api): derive client credit through a payment_credits view

Mirrors charge_balances: credit is derived, never stored, so it cannot
drift from the allocations that spend it. Every aggregate carries its
own ::int per ADR 0007.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `getAvailableCredit`

**Files:**
- Modify: `apps/api/src/billing/billing.service.ts`
- Test: `apps/api/test/billing.integration.test.ts`

**Interfaces:**
- Consumes: the `payment_credits` view (Task 2), `AllocationSource` (Task 1).
- Produces:
  ```ts
  async getAvailableCredit(clientId: string): Promise<{ sources: AllocationSource[]; totalCents: number }>
  ```
  `sources` is ordered oldest `receivedOn` first and contains only payments with `creditCents > 0`. Tasks 4, 5 and 7 call it.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/billing.integration.test.ts`:

```ts
describe('getAvailableCredit', () => {
  it('returns each payment with money left, oldest first, and their total', async () => {
    const clientId = await createClient('502111111')
    const older = uuidv7()
    const newer = uuidv7()
    await prisma.payment.create({
      data: { id: older, clientId, amountCents: 10000, receivedOn: new Date('2026-01-10T00:00:00Z'), method: 'TRANSFER' },
    })
    await prisma.payment.create({
      data: { id: newer, clientId, amountCents: 5000, receivedOn: new Date('2026-03-10T00:00:00Z'), method: 'TRANSFER' },
    })

    const credit = await billing.getAvailableCredit(clientId)

    expect(credit.totalCents).toBe(15000)
    expect(credit.sources.map((source) => source.paymentId)).toEqual([older, newer])
    expect(credit.sources[0]?.availableCents).toBe(10000)
    expect(credit.sources[0]?.receivedOn).toBeInstanceOf(Date)
  })

  it('omits a payment that is fully allocated', async () => {
    const clientId = await createClient('502222222')
    const chargeId = uuidv7()
    await prisma.charge.create({
      data: {
        id: chargeId,
        clientId,
        kind: 'EXTRA',
        description: 'Ad-hoc',
        amountCents: 9000,
        issuedOn: new Date('2026-01-01T00:00:00Z'),
        dueOn: new Date('2026-01-31T00:00:00Z'),
      },
    })
    const paymentId = uuidv7()
    await prisma.payment.create({
      data: { id: paymentId, clientId, amountCents: 9000, receivedOn: new Date('2026-02-01T00:00:00Z'), method: 'TRANSFER' },
    })
    await prisma.paymentAllocation.create({ data: { paymentId, chargeId, amountCents: 9000 } })

    const credit = await billing.getAvailableCredit(clientId)

    expect(credit.sources).toEqual([])
    expect(credit.totalCents).toBe(0)
  })

  it("never sees another client's credit", async () => {
    const mine = await createClient('502333333')
    const theirs = await createClient('502444444')
    await prisma.payment.create({
      data: { id: uuidv7(), clientId: theirs, amountCents: 20000, receivedOn: new Date('2026-01-10T00:00:00Z'), method: 'TRANSFER' },
    })

    expect((await billing.getAvailableCredit(mine)).totalCents).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @ledger-hq/api test:integration -- billing
```

Expected: FAIL with `billing.getAvailableCredit is not a function`.

- [ ] **Step 3: Implement it**

In `apps/api/src/billing/billing.service.ts`, add `AllocationSource` to the type import from `@ledger-hq/domain`, and add this method next to `proposeAllocationForClient`:

```ts
  /**
   * Money this client has already paid that no charge has claimed
   * (Phase 4a design §4.1). Ordered oldest first, which is the order
   * `proposeAllocation` spends them in.
   */
  async getAvailableCredit(clientId: string): Promise<{ sources: AllocationSource[]; totalCents: number }> {
    const rows = await this.prisma.$queryRaw<Array<{ paymentId: string; receivedOn: Date; creditCents: number }>>`
      SELECT "paymentId", "receivedOn", "creditCents"
      FROM payment_credits
      WHERE "clientId" = ${clientId}::uuid AND "creditCents" > 0
      ORDER BY "receivedOn" ASC, "paymentId" ASC
    `

    return {
      sources: rows.map((row) => ({ paymentId: row.paymentId, availableCents: row.creditCents, receivedOn: row.receivedOn })),
      totalCents: rows.reduce((sum, row) => sum + row.creditCents, 0),
    }
  }
```

The total is summed in TypeScript rather than in SQL deliberately: the rows are already being fetched, and a second `SUM` across the view would need its own `::int` for nothing.

`ORDER BY "receivedOn" ASC, "paymentId" ASC` — two payments received the same day would otherwise come back in an order Postgres does not promise, which makes the proposal non-deterministic between runs. `paymentId` is a uuidv7, so the tie-break is by creation time.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @ledger-hq/api test:integration -- billing
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/billing/billing.service.ts apps/api/test/billing.integration.test.ts
git commit -m "feat(api): read a client's available credit

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `apply-credit` — propose, then confirm

**Files:**
- Modify: `packages/domain/src/schemas/billing.ts`
- Modify: `packages/domain/src/errors.ts:34-38`
- Modify: `apps/api/src/billing/billing.service.ts`
- Modify: `apps/api/src/billing/billing.controller.ts`
- Test: `apps/api/test/billing.integration.test.ts`

**Interfaces:**
- Consumes: `getAvailableCredit` (Task 3), `proposeAllocation` (Task 1), `ProposedAllocationRow` (existing, now carrying `paymentId`).
- Produces:
  ```ts
  // packages/domain/src/schemas/billing.ts
  export const dryRunQuerySchema: z.ZodType<{ dryRun?: 'true' | 'false' }>
  export const applyCreditSchema: z.ZodType<{ allocations: Array<{ paymentId: string; chargeId: string; amountCents: number }> }>
  export type ApplyCreditInput = z.infer<typeof applyCreditSchema>

  // apps/api/src/billing/billing.service.ts
  async applyCredit(clientId: string, input: ApplyCreditInput | null, dryRun: boolean): Promise<ApplyCreditResult>
  export type ApplyCreditResult = {
    proposed: ProposedAllocationRow[]
    remainingCreditCents: number
    allocated: number
  }
  ```
  `POST /billing/clients/:clientId/apply-credit?dryRun=true|false`. On a dry run `allocated` is `0`; on a confirm, `proposed` echoes what was written.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/billing.integration.test.ts`. The `post` helper already exists in that file.

```ts
describe('POST /billing/clients/:clientId/apply-credit', () => {
  async function clientWithCreditAndCharge(taxId: string, chargeCents: number, paymentCents: number, dueOn = '2026-01-31') {
    const clientId = await createClient(taxId)
    const chargeId = uuidv7()
    await prisma.charge.create({
      data: {
        id: chargeId,
        clientId,
        kind: 'EXTRA',
        description: 'Ad-hoc',
        amountCents: chargeCents,
        issuedOn: new Date('2026-01-01T00:00:00Z'),
        dueOn: new Date(`${dueOn}T00:00:00Z`),
      },
    })
    const paymentId = uuidv7()
    await prisma.payment.create({
      data: { id: paymentId, clientId, amountCents: paymentCents, receivedOn: new Date('2026-01-05T00:00:00Z'), method: 'TRANSFER' },
    })
    return { clientId, chargeId, paymentId }
  }

  it('proposes credit against the open charge without writing anything', async () => {
    const { clientId, chargeId, paymentId } = await clientWithCreditAndCharge('503111111', 9000, 12000)

    const response = await post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=true`)

    expect(response.status).toBe(201)
    expect(response.body.proposed).toEqual([
      expect.objectContaining({ paymentId, chargeId, amountCents: 9000, description: 'Ad-hoc' }),
    ])
    expect(response.body.remainingCreditCents).toBe(3000)
    expect(response.body.allocated).toBe(0)
    expect(await prisma.paymentAllocation.count()).toBe(0)
  })

  it('defaults to a dry run when dryRun is omitted', async () => {
    const { clientId } = await clientWithCreditAndCharge('503222222', 9000, 12000)

    const response = await post(`/api/v1/billing/clients/${clientId}/apply-credit`)

    expect(response.status).toBe(201)
    expect(await prisma.paymentAllocation.count()).toBe(0)
  })

  it('writes the allocations it is given on a confirm', async () => {
    const { clientId, chargeId, paymentId } = await clientWithCreditAndCharge('503333333', 9000, 12000)

    const response = await post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=false`, {
      allocations: [{ paymentId, chargeId, amountCents: 9000 }],
    })

    expect(response.status).toBe(201)
    expect(response.body.allocated).toBe(1)
    const written = await prisma.paymentAllocation.findMany()
    expect(written).toEqual([{ paymentId, chargeId, amountCents: 9000 }])
    // The credit is spent: a second run has nothing to propose.
    const second = await post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=true`)
    expect(second.body.proposed).toEqual([])
    expect(second.body.remainingCreditCents).toBe(3000)
  })

  it('proposes nothing, and does not error, when no charge has fallen due yet', async () => {
    const clientId = await createClient('503444444')
    await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'Next month',
        amountCents: 9000,
        issuedOn: new Date('2026-01-01T00:00:00Z'),
        // Due far enough out that `asOf` (now) cannot have reached it.
        dueOn: new Date('2099-01-31T00:00:00Z'),
      },
    })
    await prisma.payment.create({
      data: { id: uuidv7(), clientId, amountCents: 12000, receivedOn: new Date('2026-01-05T00:00:00Z'), method: 'TRANSFER' },
    })

    const response = await post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=true`)

    expect(response.status).toBe(201)
    expect(response.body.proposed).toEqual([])
    expect(response.body.remainingCreditCents).toBe(12000)
  })

  it('never proposes credit against a written-off charge', async () => {
    const { clientId, chargeId } = await clientWithCreditAndCharge('503555555', 9000, 12000)
    await prisma.charge.update({ where: { id: chargeId }, data: { writtenOffAt: new Date(), writeOffReason: 'Goodwill' } })

    const response = await post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=true`)

    expect(response.body.proposed).toEqual([])
    expect(response.body.remainingCreditCents).toBe(12000)
  })

  it('rejects an allocation drawing more than the payment has left', async () => {
    const { clientId, chargeId, paymentId } = await clientWithCreditAndCharge('503666666', 20000, 5000)

    const response = await post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=false`, {
      allocations: [{ paymentId, chargeId, amountCents: 9000 }],
    })

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('billing.allocation_exceeds_available_credit')
    expect(await prisma.paymentAllocation.count()).toBe(0)
  })

  it("rejects an allocation drawing on another client's payment", async () => {
    const mine = await clientWithCreditAndCharge('503777777', 9000, 100)
    const theirs = await clientWithCreditAndCharge('503888888', 9000, 12000)

    const response = await post(`/api/v1/billing/clients/${mine.clientId}/apply-credit?dryRun=false`, {
      allocations: [{ paymentId: theirs.paymentId, chargeId: mine.chargeId, amountCents: 1 }],
    })

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('billing.allocation_exceeds_available_credit')
    expect(await prisma.paymentAllocation.count()).toBe(0)
  })

  it('serialises two confirms racing for the same credit', async () => {
    const { clientId, chargeId, paymentId } = await clientWithCreditAndCharge('503999999', 20000, 9000)

    const body = { allocations: [{ paymentId, chargeId, amountCents: 9000 }] }
    const [first, second] = await Promise.all([
      post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=false`, body),
      post(`/api/v1/billing/clients/${clientId}/apply-credit?dryRun=false`, body),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([201, 422])
    // 90,00 EUR of credit can only be spent once, whichever request won.
    const total = await prisma.paymentAllocation.aggregate({ _sum: { amountCents: true } })
    expect(total._sum.amountCents).toBe(9000)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @ledger-hq/api test:integration -- billing
```

Expected: FAIL with 404 on every request — the route does not exist.

- [ ] **Step 3: Add the error code**

In `packages/domain/src/errors.ts`, add one entry to the billing block (after `'billing.allocation_exceeds_charge_balance'`):

```ts
  'billing.allocation_exceeds_available_credit',
```

- [ ] **Step 4: Add the schemas**

In `packages/domain/src/schemas/billing.ts`, replace the `generateChargesQuerySchema` declaration with a shared one, keeping the old exported name so nothing else has to change:

```ts
/** `?dryRun=true|false` — shared by every write endpoint that previews first. */
export const dryRunQuerySchema = z
  .object({ dryRun: z.enum(['true', 'false']).optional() })
  .strict()

export type DryRunQuery = z.infer<typeof dryRunQuerySchema>

export const generateChargesQuerySchema = dryRunQuerySchema
export type GenerateChargesQuery = DryRunQuery
```

And add, next to `recordPaymentSchema`:

```ts
/**
 * A confirm body. Omitted entirely on a dry run, which proposes rather than
 * applies — hence every field optional at the top level.
 */
export const applyCreditSchema = z
  .object({
    allocations: z
      .array(
        z.object({
          paymentId: uuidSchema,
          chargeId: uuidSchema,
          amountCents: z.number().int().positive(),
        }),
      )
      .default([]),
  })
  .strict()

export type ApplyCreditInput = z.infer<typeof applyCreditSchema>
```

- [ ] **Step 5: Implement the service method**

In `apps/api/src/billing/billing.service.ts`, add `ApplyCreditInput` to the type import from `@ledger-hq/domain`, add the result type next to `GenerateChargesResult`:

```ts
export type ApplyCreditResult = {
  proposed: ProposedAllocationRow[]
  remainingCreditCents: number
  allocated: number
}
```

Factor the open-charge lookup out of `proposeAllocationForClient` so both callers share it, and add the two new methods:

```ts
  /**
   * A client's charges that are open, due, and not forgiven — the only
   * charges any proposal may touch. `charge_balances` carries no
   * `description` (it is derived state over amounts, not a copy of the
   * charge), so the charge is joined back in for the human-readable half.
   */
  private async openChargesFor(clientId: string, asOf: Date): Promise<Array<ChargeBalance & { description: string }>> {
    return this.prisma.$queryRaw<Array<ChargeBalance & { description: string }>>`
      SELECT b.*, c.description
      FROM charge_balances b
      JOIN "Charge" c ON c.id = b.id
      WHERE b."clientId" = ${clientId}::uuid
        AND b."outstandingCents" > 0
        AND b.status != 'WRITTEN_OFF'
        AND b."dueOn" <= ${asOf}
      ORDER BY b."dueOn" ASC
    `
  }

  /** Decorates a bare proposal with what identifies each charge to a human. */
  private toProposalRows(proposed: ProposedAllocation[], charges: Array<ChargeBalance & { description: string }>): ProposedAllocationRow[] {
    const byId = new Map(charges.map((charge) => [charge.id, charge]))
    return proposed.map((allocation) => {
      const charge = byId.get(allocation.chargeId)
      return {
        paymentId: allocation.paymentId,
        chargeId: allocation.chargeId,
        amountCents: allocation.amountCents,
        description: charge?.description ?? '',
        periodLabel: charge?.periodLabel ?? null,
        dueOn: charge ? isoDate(charge.dueOn) : null,
      }
    })
  }

  /**
   * Spends credit the client already paid against charges already due
   * (Phase 4a design §4.3). Same propose-then-confirm discipline as
   * `recordPayment`, without a new payment: a dry run proposes, a confirm
   * writes exactly the allocations it was handed, re-validated against the
   * database's own view of both halves.
   */
  async applyCredit(clientId: string, input: ApplyCreditInput | null, dryRun: boolean): Promise<ApplyCreditResult> {
    const asOf = new Date()
    const credit = await this.getAvailableCredit(clientId)

    if (dryRun) {
      const charges = await this.openChargesFor(clientId, asOf)
      const proposed = proposeAllocation(credit.sources, charges)
      const allocatedCents = proposed.reduce((sum, allocation) => sum + allocation.amountCents, 0)
      return { proposed: this.toProposalRows(proposed, charges), remainingCreditCents: credit.totalCents - allocatedCents, allocated: 0 }
    }

    const allocations = input?.allocations ?? []
    if (allocations.length === 0) return { proposed: [], remainingCreditCents: credit.totalCents, allocated: 0 }

    await this.prisma.$transaction(async (tx) => {
      for (const allocation of allocations) {
        // Two locks, payment first then charge. `recordPayment` locks only
        // the charge, and cannot deadlock against this: the payment it
        // allocates from is created inside its own transaction, so no other
        // writer can be holding that row. `FOR UPDATE` cannot be taken on
        // either view (Postgres rejects it on a grouped query), so both
        // locks go on the base tables.
        await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${allocation.paymentId}::uuid FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM "Charge" WHERE id = ${allocation.chargeId}::uuid FOR UPDATE`

        // Bound to this client on both sides: without it, a stale proposal
        // held across a client navigation could spend one client's credit on
        // another client's debt.
        const [credited] = await tx.$queryRaw<Array<{ creditCents: number }>>`
          SELECT "creditCents" FROM payment_credits
          WHERE "paymentId" = ${allocation.paymentId}::uuid AND "clientId" = ${clientId}::uuid
        `
        if (!credited || allocation.amountCents > credited.creditCents) {
          throw new AppError('billing.allocation_exceeds_available_credit', { paymentId: allocation.paymentId }, 422)
        }

        const [balance] = await tx.$queryRaw<Array<{ outstandingCents: number }>>`
          SELECT "outstandingCents" FROM charge_balances
          WHERE id = ${allocation.chargeId}::uuid
            AND "clientId" = ${clientId}::uuid
            AND status != 'WRITTEN_OFF'
        `
        if (!balance || allocation.amountCents > balance.outstandingCents) {
          throw new AppError('billing.allocation_exceeds_charge_balance', { chargeId: allocation.chargeId }, 422)
        }

        // An upsert, not a create: the composite primary key is
        // (paymentId, chargeId), so a second allocation from the same
        // payment to the same charge adds to the first rather than failing
        // on a key collision.
        await tx.paymentAllocation.upsert({
          where: { paymentId_chargeId: { paymentId: allocation.paymentId, chargeId: allocation.chargeId } },
          create: { paymentId: allocation.paymentId, chargeId: allocation.chargeId, amountCents: allocation.amountCents },
          update: { amountCents: { increment: allocation.amountCents } },
        })
      }
    })

    const after = await this.getAvailableCredit(clientId)
    return { proposed: [], remainingCreditCents: after.totalCents, allocated: allocations.length }
  }
```

Then shrink `proposeAllocationForClient` to use the two new helpers, so the open-charge query exists once:

```ts
  async proposeAllocationForClient(clientId: string, amountCents: number): Promise<{ proposed: ProposedAllocationRow[]; excessCents: number }> {
    const charges = await this.openChargesFor(clientId, new Date())
    // One source: the payment being recorded now, which has no id yet.
    const proposed = proposeAllocation([{ paymentId: null, availableCents: amountCents, receivedOn: new Date() }], charges)
    const allocatedCents = proposed.reduce((sum, allocation) => sum + allocation.amountCents, 0)
    return { proposed: this.toProposalRows(proposed, charges), excessCents: amountCents - allocatedCents }
  }
```

Note this tightens `proposeAllocationForClient` by one condition: it now excludes charges that have not fallen due, which `openChargesFor` filters on. That matches `getReceivables`, which has always used `dueOn <= asOf`, and matches what an operator means by "what does this payment settle".

- [ ] **Step 6: Add the route**

In `apps/api/src/billing/billing.controller.ts`, add `applyCreditSchema` and `dryRunQuerySchema` to the value import, `ApplyCreditInput` and `DryRunQuery` to the type import, `ApplyCreditResult` to the type import from `./billing.service.js`, and the route after `recordPayment`:

```ts
  @Post('clients/:clientId/apply-credit')
  async applyCredit(
    @Param('clientId') clientId: string,
    @Query(new ZodValidationPipe(dryRunQuerySchema)) query: DryRunQuery,
    @Body(new ZodValidationPipe(applyCreditSchema)) body: ApplyCreditInput,
  ): Promise<ApplyCreditResult> {
    // Same safe default as generate-charges: an omitted or malformed dryRun
    // never applies.
    return this.billing.applyCredit(clientId, body, query.dryRun !== 'false')
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/api test:integration -- billing
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS everywhere. The racing test relies on the `FOR UPDATE` on `Payment`: the loser re-reads `creditCents` as `0` after the winner commits and fails the 422 check.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src apps/api/src/billing apps/api/test/billing.integration.test.ts
git commit -m "feat(api): spend client credit through propose-then-confirm

POST /billing/clients/:id/apply-credit proposes a FIFO allocation of a
client's unspent payments against its due charges, and writes only what
the operator confirms. Both halves are re-validated inside the
transaction against payment_credits and charge_balances, under a
payment-then-charge lock order.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Charge generation applies credit in the same transaction

**Files:**
- Modify: `apps/api/src/billing/billing.service.ts` (`generateCharges`, `GenerateChargesResult`)
- Test: `apps/api/test/billing.integration.test.ts`

**Interfaces:**
- Consumes: `getAvailableCredit` (Task 3), `proposeAllocation` (Task 1), `openChargesFor`/`toProposalRows` (Task 4).
- Produces:
  ```ts
  export type GenerateChargesResult = {
    toCreate: Array<{ clientId: string; planId: string; periodLabel: string; amountCents: number; dueOn: string }>
    creditToAllocate: ProposedAllocationRow[]
    created: number
    allocated: number
  }
  ```
  `created` and `allocated` are `0` on a dry run. Task 8 reads this type on the web side.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/billing.integration.test.ts`:

```ts
describe('generateCharges and client credit', () => {
  async function clientWithPlanAndCredit(taxId: string, creditCents: number) {
    const clientId = await createClient(taxId)
    await prisma.retainerPlan.create({
      data: {
        id: uuidv7(),
        clientId,
        amountCents: 9000,
        periodicity: 'MONTHLY',
        dueDayOfMonth: 8,
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validTo: null,
      },
    })
    await prisma.payment.create({
      data: { id: uuidv7(), clientId, amountCents: creditCents, receivedOn: new Date('2026-01-02T00:00:00Z'), method: 'TRANSFER' },
    })
    return clientId
  }

  it('previews the credit it would spend on the charges it would create', async () => {
    const clientId = await clientWithPlanAndCredit('504111111', 27000)

    const result = await billing.generateCharges({ asOf: new Date('2026-03-15T00:00:00Z'), clientId }, true)

    expect(result.toCreate).toHaveLength(3)
    expect(result.created).toBe(0)
    expect(result.allocated).toBe(0)
    // Three 90,00 EUR charges, 270,00 EUR of credit: all three settled.
    expect(result.creditToAllocate.reduce((sum, row) => sum + row.amountCents, 0)).toBe(27000)
    expect(await prisma.charge.count()).toBe(0)
    expect(await prisma.paymentAllocation.count()).toBe(0)
  })

  it('creates the charges and spends the credit in one run', async () => {
    const clientId = await clientWithPlanAndCredit('504222222', 27000)

    const result = await billing.generateCharges({ asOf: new Date('2026-03-15T00:00:00Z'), clientId }, false)

    expect(result.created).toBe(3)
    expect(result.allocated).toBe(3)
    const balances = await prisma.$queryRaw<Array<{ outstandingCents: number }>>`
      SELECT "outstandingCents" FROM charge_balances WHERE "clientId" = ${clientId}::uuid
    `
    expect(balances.every((row) => row.outstandingCents === 0)).toBe(true)
    expect((await billing.getAvailableCredit(clientId)).totalCents).toBe(0)
  })

  it('spends partial credit across as many charges as it reaches', async () => {
    const clientId = await clientWithPlanAndCredit('504333333', 10000)

    await billing.generateCharges({ asOf: new Date('2026-03-15T00:00:00Z'), clientId }, false)

    const balances = await prisma.$queryRaw<Array<{ outstandingCents: number; dueOn: Date }>>`
      SELECT "outstandingCents", "dueOn" FROM charge_balances WHERE "clientId" = ${clientId}::uuid ORDER BY "dueOn" ASC
    `
    // 100,00 EUR against three 90,00 EUR charges: the first settled, the
    // second 10,00 EUR in, the third untouched.
    expect(balances.map((row) => row.outstandingCents)).toEqual([0, 8000, 9000])
  })

  it('generates charges unchanged for a client with no credit', async () => {
    const clientId = await createClient('504444444')
    await prisma.retainerPlan.create({
      data: {
        id: uuidv7(),
        clientId,
        amountCents: 9000,
        periodicity: 'MONTHLY',
        dueDayOfMonth: 8,
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validTo: null,
      },
    })

    const result = await billing.generateCharges({ asOf: new Date('2026-02-15T00:00:00Z'), clientId }, false)

    expect(result.created).toBe(2)
    expect(result.allocated).toBe(0)
    expect(result.creditToAllocate).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @ledger-hq/api test:integration -- billing
```

Expected: FAIL — `result.creditToAllocate` is `undefined`, `result.created` is `undefined`.

- [ ] **Step 3: Extend the result type**

In `apps/api/src/billing/billing.service.ts`, replace `GenerateChargesResult`:

```ts
export type GenerateChargesResult = {
  toCreate: Array<{ clientId: string; planId: string; periodLabel: string; amountCents: number; dueOn: string }>
  /** What the credit on hand would settle, once `toCreate` exists. Empty when no client has credit. */
  creditToAllocate: ProposedAllocationRow[]
  created: number
  allocated: number
}
```

- [ ] **Step 4: Implement**

In `generateCharges`, replace the `if (!dryRun) { ... }` block and the `return` with:

```ts
    const clientIds = [...new Set(toCreate.map((item) => item.clientId))]
    let created = 0
    let allocated = 0
    const creditToAllocate: ProposedAllocationRow[] = []

    if (dryRun) {
      // The charges do not exist yet, so the proposal is built from what
      // `toCreate` describes rather than from `charge_balances`: a preview
      // that ignored them would always report nothing to spend.
      for (const clientId of clientIds) {
        const credit = await this.getAvailableCredit(clientId)
        if (credit.totalCents === 0) continue

        const pending = toCreate
          .filter((item) => item.clientId === clientId)
          .map((item) => ({
            id: `pending:${item.planId}:${item.period.label}`,
            clientId,
            kind: 'RETAINER' as const,
            periodLabel: item.period.label,
            dueOn: item.dueOn,
            amountCents: item.amountCents,
            allocatedCents: 0,
            outstandingCents: item.amountCents,
            status: 'OPEN' as const,
            description: `Retainer — ${item.period.label}`,
          }))

        const existing = await this.openChargesFor(clientId, input.asOf)
        const charges = [...existing, ...pending]
        creditToAllocate.push(...this.toProposalRows(proposeAllocation(credit.sources, charges), charges))
      }

      return { toCreate: toCreate.map(toWireItem), creditToAllocate, created: 0, allocated: 0 }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of toCreate) {
        await tx.charge.create({
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
        created += 1
      }
    })

    // Outside the creation transaction, and deliberately: a client whose
    // credit cannot be spent for any reason must still get its charges. The
    // charges are the statement of debt; spending credit against them is a
    // convenience that can be retried from the ledger.
    for (const clientId of clientIds) {
      const credit = await this.getAvailableCredit(clientId)
      if (credit.totalCents === 0) continue

      const charges = await this.openChargesFor(clientId, input.asOf)
      const proposed = proposeAllocation(credit.sources, charges)
      if (proposed.length === 0) continue

      const result = await this.applyCredit(clientId, { allocations: proposed.map(toConfirmedAllocation) }, false)
      allocated += result.allocated
      creditToAllocate.push(...this.toProposalRows(proposed, charges))
    }

    return { toCreate: toCreate.map(toWireItem), creditToAllocate, created, allocated }
```

Add the two small mappers as module-level functions beside `isoDate`:

```ts
function toWireItem(item: { clientId: string; planId: string; period: { label: string }; amountCents: number; dueOn: Date }) {
  return { clientId: item.clientId, planId: item.planId, periodLabel: item.period.label, amountCents: item.amountCents, dueOn: isoDate(item.dueOn) }
}

/**
 * A confirmed allocation always names a real payment. `paymentId` is only
 * ever `null` for the payment being recorded in the same request, which this
 * path never has.
 */
function toConfirmedAllocation(allocation: ProposedAllocation): { paymentId: string; chargeId: string; amountCents: number } {
  if (allocation.paymentId === null) throw new AppError('billing.allocation_exceeds_available_credit', {}, 422)
  return { paymentId: allocation.paymentId, chargeId: allocation.chargeId, amountCents: allocation.amountCents }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/api test:integration -- billing
pnpm --filter @ledger-hq/api test
```

Expected: PASS. `billing.cron.test.ts` still passes untouched — the cron calls `generateCharges(..., false)` and now applies credit as a side effect, which is the intended behaviour change.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/billing/billing.service.ts apps/api/test/billing.integration.test.ts
git commit -m "feat(api): spend credit against the charges generation creates

The dry run previews what the credit on hand would settle, including the
charges that do not exist yet; the apply run creates the charges and
then spends the credit, so the nightly cron closes advance payments
without anyone opening the ledger.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Receivables net credit, and carry both parts

**Files:**
- Modify: `apps/api/src/billing/billing.service.ts` (`getReceivables`)
- Test: `apps/api/test/billing.integration.test.ts`

**Interfaces:**
- Consumes: the `payment_credits` view (Task 2).
- Produces:
  ```ts
  async getReceivables(asOf: Date): Promise<Array<{
    clientId: string
    clientName: string
    grossOutstandingCents: number
    creditCents: number
    outstandingCents: number   // net, floored at zero
    oldestDueOn: string
    ageingBucket: '0-30' | '31-60' | '61-90' | '90+'
  }>>
  ```
  Tasks 8 and 9 read this shape on the web side. `outstandingCents` keeps its name and its meaning of "what this client owes", so `SummaryRow`'s existing sum becomes a net total with no change to that component.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/billing.integration.test.ts`:

```ts
describe('getReceivables and client credit', () => {
  async function overdueClient(taxId: string, name: string, charges: Array<{ cents: number; dueOn: string }>, creditCents = 0) {
    const clientId = await createClient(taxId, name)
    for (const charge of charges) {
      await prisma.charge.create({
        data: {
          id: uuidv7(),
          clientId,
          kind: 'EXTRA',
          description: `Ad-hoc ${charge.dueOn}`,
          amountCents: charge.cents,
          issuedOn: new Date('2026-01-01T00:00:00Z'),
          dueOn: new Date(`${charge.dueOn}T00:00:00Z`),
        },
      })
    }
    if (creditCents > 0) {
      await prisma.payment.create({
        data: { id: uuidv7(), clientId, amountCents: creditCents, receivedOn: new Date('2026-01-02T00:00:00Z'), method: 'TRANSFER' },
      })
    }
    return clientId
  }

  const asOf = new Date('2026-06-30T00:00:00Z')

  it('nets credit off the debt and reports both parts', async () => {
    const clientId = await overdueClient('505111111', 'Partly Covered', [{ cents: 20000, dueOn: '2026-05-31' }], 15000)

    const [row] = await billing.getReceivables(asOf)

    expect(row?.clientId).toBe(clientId)
    expect(row?.grossOutstandingCents).toBe(20000)
    expect(row?.creditCents).toBe(15000)
    expect(row?.outstandingCents).toBe(5000)
  })

  it('drops a client whose credit covers everything, and never reports a negative', async () => {
    await overdueClient('505222222', 'Fully Covered', [{ cents: 9000, dueOn: '2026-05-31' }], 30000)

    expect(await billing.getReceivables(asOf)).toEqual([])
  })

  it('ages by the oldest charge the credit does not reach', async () => {
    await overdueClient(
      '505333333',
      'Aged',
      [
        // 210+ days overdue, settled on paper by the credit.
        { cents: 9000, dueOn: '2026-01-05' },
        // ~30 days overdue, the one that still stands.
        { cents: 9000, dueOn: '2026-06-01' },
      ],
      9000,
    )

    const [row] = await billing.getReceivables(asOf)

    expect(row?.oldestDueOn).toBe('2026-06-01')
    expect(row?.ageingBucket).toBe('0-30')
  })

  it('leaves a client with no credit exactly as before', async () => {
    await overdueClient('505444444', 'Plain Debtor', [{ cents: 9000, dueOn: '2026-01-05' }])

    const [row] = await billing.getReceivables(asOf)

    expect(row?.grossOutstandingCents).toBe(9000)
    expect(row?.creditCents).toBe(0)
    expect(row?.outstandingCents).toBe(9000)
    expect(row?.ageingBucket).toBe('90+')
  })

  it('does not let credit settle a written-off charge', async () => {
    const clientId = await overdueClient('505555555', 'Forgiven', [{ cents: 9000, dueOn: '2026-05-31' }], 9000)
    const charge = await prisma.charge.findFirstOrThrow({ where: { clientId } })
    await prisma.charge.update({ where: { id: charge.id }, data: { writtenOffAt: new Date(), writeOffReason: 'Goodwill' } })

    // Nothing is owed, so nothing is listed — but the credit must still be
    // intact, not quietly consumed by a debt that was forgiven.
    expect(await billing.getReceivables(asOf)).toEqual([])
    expect((await billing.getAvailableCredit(clientId)).totalCents).toBe(9000)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @ledger-hq/api test:integration -- billing
```

Expected: FAIL — `grossOutstandingCents` is `undefined`, and the "fully covered" client is still listed.

- [ ] **Step 3: Implement**

Replace `getReceivables` in `apps/api/src/billing/billing.service.ts`:

```ts
  /**
   * Who owes what, netted against what they have already paid but not yet
   * spent (Phase 4a design §4.4). The netting is **notional**: no allocation
   * is written here. Both parts travel so the operator can see where the net
   * figure came from without opening the client.
   */
  async getReceivables(asOf: Date): Promise<
    Array<{
      clientId: string
      clientName: string
      grossOutstandingCents: number
      creditCents: number
      outstandingCents: number
      oldestDueOn: string
      ageingBucket: '0-30' | '31-60' | '61-90' | '90+'
    }>
  > {
    // Per charge, not per client: the ageing bucket has to know which
    // individual charges the credit reaches before it can say how old the
    // rest are.
    const charges = await this.prisma.$queryRaw<Array<{ clientId: string; clientName: string; dueOn: Date; outstandingCents: number }>>`
      SELECT c.id AS "clientId", c.name AS "clientName", b."dueOn", b."outstandingCents"
      FROM charge_balances b
      JOIN "Client" c ON c.id = b."clientId"
      WHERE b."outstandingCents" > 0 AND b.status != 'WRITTEN_OFF' AND b."dueOn" <= ${asOf}
      ORDER BY c.id, b."dueOn" ASC
    `

    const credits = await this.prisma.$queryRaw<Array<{ clientId: string; creditCents: number }>>`
      SELECT "clientId", SUM("creditCents")::int AS "creditCents"
      FROM payment_credits
      WHERE "creditCents" > 0
      GROUP BY "clientId"
    `
    const creditByClient = new Map(credits.map((row) => [row.clientId, row.creditCents]))

    const byClient = new Map<string, { clientName: string; charges: Array<{ dueOn: Date; outstandingCents: number }> }>()
    for (const charge of charges) {
      const entry = byClient.get(charge.clientId) ?? { clientName: charge.clientName, charges: [] }
      entry.charges.push({ dueOn: charge.dueOn, outstandingCents: charge.outstandingCents })
      byClient.set(charge.clientId, entry)
    }

    const rows = []
    for (const [clientId, entry] of byClient) {
      const grossOutstandingCents = entry.charges.reduce((sum, charge) => sum + charge.outstandingCents, 0)
      const creditCents = creditByClient.get(clientId) ?? 0

      // Spend the credit on paper, oldest charge first — the same order a
      // real allocation would use — and keep the first charge it fails to
      // cover. That charge, not the oldest debt on the books, is what this
      // client is actually overdue on.
      let remainingCredit = creditCents
      let oldestUncovered: Date | null = null
      for (const charge of entry.charges) {
        if (remainingCredit >= charge.outstandingCents) {
          remainingCredit -= charge.outstandingCents
          continue
        }
        oldestUncovered = charge.dueOn
        break
      }

      const outstandingCents = Math.max(grossOutstandingCents - creditCents, 0)
      if (outstandingCents === 0 || oldestUncovered === null) continue

      const daysOverdue = Math.floor((asOf.getTime() - oldestUncovered.getTime()) / ONE_DAY_MS)
      const ageingBucket = daysOverdue > 90 ? '90+' : daysOverdue > 60 ? '61-90' : daysOverdue > 30 ? '31-60' : '0-30'

      rows.push({
        clientId,
        clientName: entry.clientName,
        grossOutstandingCents,
        creditCents,
        outstandingCents,
        oldestDueOn: isoDate(oldestUncovered),
        ageingBucket: ageingBucket as '0-30' | '31-60' | '61-90' | '90+',
      })
    }

    return rows.sort((a, b) => a.oldestDueOn.localeCompare(b.oldestDueOn))
  }
```

`SUM("creditCents")::int` carries its own cast even though `creditCents` is already an `int` in the view — ADR 0007's rule is per-aggregate, because a `SUM` over an `int` is a fresh `bigint`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/api test:integration -- billing
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS. Existing receivables tests keep passing: a client with no credit nets to the same figure and the same bucket.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/billing/billing.service.ts apps/api/test/billing.integration.test.ts
git commit -m "feat(api): net client credit off receivables, notionally

Receivables now report gross, credit and net, with ageing computed over
the charges the credit does not reach. Nothing is written: money still
only moves through a confirmed proposal.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The client ledger reports available credit

**Files:**
- Modify: `apps/api/src/billing/billing.service.ts` (`getClientLedger`)
- Test: `apps/api/test/billing.integration.test.ts`

**Interfaces:**
- Consumes: `getAvailableCredit` (Task 3).
- Produces: `getClientLedger` returns `{ entries: LedgerEntry[]; balanceCents: number; availableCreditCents: number }`. Task 8 reads it.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/billing.integration.test.ts`:

```ts
describe('getClientLedger and client credit', () => {
  it('reports unspent payment money as available credit', async () => {
    const clientId = await createClient('506111111')
    await prisma.payment.create({
      data: { id: uuidv7(), clientId, amountCents: 27000, receivedOn: new Date('2026-01-05T00:00:00Z'), method: 'TRANSFER' },
    })

    const ledger = await billing.getClientLedger(clientId)

    expect(ledger.availableCreditCents).toBe(27000)
    // The running balance already netted the payment in full before this
    // phase; that behaviour is unchanged.
    expect(ledger.balanceCents).toBe(-27000)
  })

  it('reports zero once every cent is allocated', async () => {
    const clientId = await createClient('506222222')
    const chargeId = uuidv7()
    await prisma.charge.create({
      data: {
        id: chargeId,
        clientId,
        kind: 'EXTRA',
        description: 'Ad-hoc',
        amountCents: 9000,
        issuedOn: new Date('2026-01-01T00:00:00Z'),
        dueOn: new Date('2026-01-31T00:00:00Z'),
      },
    })
    const paymentId = uuidv7()
    await prisma.payment.create({
      data: { id: paymentId, clientId, amountCents: 9000, receivedOn: new Date('2026-02-01T00:00:00Z'), method: 'TRANSFER' },
    })
    await prisma.paymentAllocation.create({ data: { paymentId, chargeId, amountCents: 9000 } })

    expect((await billing.getClientLedger(clientId)).availableCreditCents).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @ledger-hq/api test:integration -- billing
```

Expected: FAIL — `availableCreditCents` is `undefined`.

- [ ] **Step 3: Implement**

In `getClientLedger`, change the signature's return type to
`Promise<{ entries: LedgerEntry[]; balanceCents: number; availableCreditCents: number }>`, add one call near the top:

```ts
    const credit = await this.getAvailableCredit(clientId)
```

and add the field to the final return:

```ts
    return { entries, balanceCents: runningBalanceCents, availableCreditCents: credit.totalCents }
```

(Keep whatever the existing final `return` computes for `entries` and `balanceCents` — only the third field is new.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @ledger-hq/api test:integration -- billing
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/billing/billing.service.ts apps/api/test/billing.integration.test.ts
git commit -m "feat(api): report available credit on the client ledger

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Apply credit from the client ledger

**Files:**
- Modify: `apps/web/src/billing/api.ts`
- Create: `apps/web/src/billing/ApplyCreditForm.tsx`
- Modify: `apps/web/src/billing/ClientLedgerSection.tsx`
- Modify: `apps/web/src/i18n/locales/pt/billing.json`
- Modify: `apps/web/src/i18n/locales/en/billing.json`
- Test: `apps/web/src/billing/ClientLedgerSection.test.tsx`

**Interfaces:**
- Consumes: `GET /billing/clients/:id/ledger` now carrying `availableCreditCents` (Task 7); `POST /billing/clients/:id/apply-credit` (Task 4).
- Produces:
  ```ts
  // apps/web/src/billing/api.ts
  export type ProposedAllocation = { paymentId: string | null; chargeId: string; amountCents: number }
  export type ClientLedger = { entries: LedgerEntry[]; balanceCents: number; availableCreditCents: number }
  export type ApplyCreditResult = { proposed: ProposedAllocationRow[]; remainingCreditCents: number; allocated: number }
  export function applyCredit(clientId: string, dryRun: boolean, allocations?: ProposedAllocation[]): Promise<ApplyCreditResult>

  // apps/web/src/billing/ApplyCreditForm.tsx
  export function ApplyCreditForm(props: { clientId: string; availableCreditCents: number; onApplied: () => void }): JSX.Element | null
  ```

- [ ] **Step 1: Add the new i18n keys, both locales**

In `apps/web/src/i18n/locales/pt/billing.json`, add a `credit` block after `ledger`:

```json
  "credit": {
    "title": "Crédito disponível",
    "hint": "Dinheiro já recebido que ainda não foi aplicado a nenhuma cobrança.",
    "propose": "Aplicar crédito",
    "confirm": "Confirmar",
    "nothingToApply": "Não há cobranças vencidas onde aplicar este crédito.",
    "remaining": "Sobram {{amount}} de crédito."
  },
```

and the same block in `apps/web/src/i18n/locales/en/billing.json`:

```json
  "credit": {
    "title": "Available credit",
    "hint": "Money already received that no charge has claimed yet.",
    "propose": "Apply credit",
    "confirm": "Confirm",
    "nothingToApply": "There are no charges due for this credit to settle.",
    "remaining": "{{amount}} of credit left over."
  },
```

- [ ] **Step 2: Write the failing component tests**

Append to `apps/web/src/billing/ClientLedgerSection.test.tsx`, following that file's existing mock and render helpers (it already mocks `./api`; add `applyCredit` to the mocked module and `availableCreditCents` to every `getClientLedger` fixture it returns — a missing field would otherwise render the section with `undefined` credit):

```ts
describe('client credit', () => {
  it('offers the credit and its amount when there is any', async () => {
    getClientLedgerMock.mockResolvedValue({ entries: [], balanceCents: -27000, availableCreditCents: 27000 })

    renderSection()

    expect(await screen.findByText(shown(formatCurrency(27000, 'pt-PT')))).toBeVisible()
    expect(screen.getByRole('button', { name: /aplicar crédito/i })).toBeVisible()
  })

  it('hides the action entirely when there is no credit', async () => {
    getClientLedgerMock.mockResolvedValue({ entries: [], balanceCents: 0, availableCreditCents: 0 })

    renderSection()

    await waitFor(() => expect(screen.queryByRole('button', { name: /aplicar crédito/i })).toBeNull())
  })

  it('proposes first, and only writes after the operator confirms', async () => {
    getClientLedgerMock.mockResolvedValue({ entries: [], balanceCents: -27000, availableCreditCents: 27000 })
    applyCreditMock.mockResolvedValueOnce({
      proposed: [{ paymentId: 'p1', chargeId: 'c1', amountCents: 9000, description: 'Retainer — 2026-01', periodLabel: '2026-01', dueOn: '2026-01-08' }],
      remainingCreditCents: 18000,
      allocated: 0,
    })
    applyCreditMock.mockResolvedValueOnce({ proposed: [], remainingCreditCents: 18000, allocated: 1 })

    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /aplicar crédito/i }))
    expect(await screen.findByText(/retainer — 2026-01/i)).toBeVisible()
    // The proposal is a preview: nothing has been written yet.
    expect(applyCreditMock).toHaveBeenLastCalledWith(expect.any(String), true)

    await userEvent.click(screen.getByRole('button', { name: /^confirmar$/i }))
    await waitFor(() =>
      expect(applyCreditMock).toHaveBeenLastCalledWith(expect.any(String), false, [
        { paymentId: 'p1', chargeId: 'c1', amountCents: 9000 },
      ]),
    )
  })

  it('says so when there is credit but nothing due to spend it on', async () => {
    getClientLedgerMock.mockResolvedValue({ entries: [], balanceCents: -27000, availableCreditCents: 27000 })
    applyCreditMock.mockResolvedValueOnce({ proposed: [], remainingCreditCents: 27000, allocated: 0 })

    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /aplicar crédito/i }))
    expect(await screen.findByText(/não há cobranças vencidas/i)).toBeVisible()
  })
})
```

Add `import userEvent from '@testing-library/user-event'` if the file does not already import it, and declare the new mock beside the existing ones:

```ts
const applyCreditMock = vi.hoisted(() => vi.fn())
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- ClientLedgerSection
```

Expected: FAIL — no Apply-credit button exists.

- [ ] **Step 4: Extend the web API client**

In `apps/web/src/billing/api.ts`:

```ts
export type ProposedAllocation = { paymentId: string | null; chargeId: string; amountCents: number }

export type ClientLedger = { entries: LedgerEntry[]; balanceCents: number; availableCreditCents: number }

export type ApplyCreditResult = { proposed: ProposedAllocationRow[]; remainingCreditCents: number; allocated: number }

export function applyCredit(clientId: string, dryRun: boolean, allocations?: ProposedAllocation[]): Promise<ApplyCreditResult> {
  return apiFetch(`/billing/clients/${clientId}/apply-credit?dryRun=${dryRun}`, {
    method: 'POST',
    body: { allocations: allocations ?? [] },
  })
}
```

and extend `GenerateChargesResult` to match Task 5's server shape:

```ts
export type GenerateChargesResult = {
  toCreate: Array<{ clientId: string; planId: string; periodLabel: string; amountCents: number; dueOn: string }>
  creditToAllocate: ProposedAllocationRow[]
  created: number
  allocated: number
}
```

- [ ] **Step 5: Write `ApplyCreditForm`**

Create `apps/web/src/billing/ApplyCreditForm.tsx`. It mirrors `RecordPaymentForm`'s propose-then-confirm shape, minus the payment fields:

```tsx
import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Money } from '../ui'
import { formatCurrency, formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { applyCredit } from './api'
import type { ApplyCreditResult } from './api'

type Props = { clientId: string; availableCreditCents: number; onApplied: () => void }

/**
 * Spends credit the client already paid. Renders nothing at all when there
 * is none: an action that can only ever propose an empty list is worse than
 * no action.
 */
export function ApplyCreditForm({ clientId, availableCreditCents, onApplied }: Props) {
  const { t, i18n } = useTranslation(['billing', 'common'])
  const titleId = useId()
  const [proposal, setProposal] = useState<ApplyCreditResult | null>(null)

  const propose = useMutation({
    mutationFn: () => applyCredit(clientId, true),
    onSuccess: (result) => setProposal(result),
  })

  const confirm = useMutation({
    mutationFn: () =>
      applyCredit(
        clientId,
        false,
        // Only the allocation itself goes back on the wire; the description
        // and period the proposal carries are for the operator, and the
        // endpoint's schema is strict.
        (proposal?.proposed ?? []).map((row) => ({ paymentId: row.paymentId, chargeId: row.chargeId, amountCents: row.amountCents })),
      ),
    onSuccess: () => {
      setProposal(null)
      onApplied()
    },
  })

  if (availableCreditCents <= 0) return null

  return (
    <section aria-labelledby={titleId} className="flex max-w-sm flex-col gap-3">
      <h3 id={titleId} className="font-medium">
        {t('billing:credit.title')}
      </h3>

      <p className="flex items-center justify-between text-sm">
        <span className="text-muted">{t('billing:credit.hint')}</span>
        <Money cents={availableCreditCents} tone="credit" />
      </p>

      <ErrorMessage error={propose.error} />

      {proposal === null ? (
        <button
          type="button"
          onClick={() => propose.mutate()}
          disabled={propose.isPending}
          className="self-start rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {t('billing:credit.propose')}
        </button>
      ) : proposal.proposed.length === 0 ? (
        <p className="text-sm text-muted">{t('billing:credit.nothingToApply')}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1 rounded border border-slate-200 p-2 text-sm">
            {proposal.proposed.map((allocation) => (
              <li key={`${allocation.paymentId}:${allocation.chargeId}`} className="flex items-center justify-between">
                <span>
                  {allocation.description}
                  {allocation.dueOn !== null && (
                    <span className="text-slate-500"> · {formatDate(allocation.dueOn, i18n.language as SupportedLocale)}</span>
                  )}
                </span>
                <span>{formatCurrency(allocation.amountCents, i18n.language as SupportedLocale)}</span>
              </li>
            ))}
          </ul>
          {proposal.remainingCreditCents > 0 && (
            <p className="text-xs text-slate-600">
              {t('billing:credit.remaining', { amount: formatCurrency(proposal.remainingCreditCents, i18n.language as SupportedLocale) })}
            </p>
          )}
          <ErrorMessage error={confirm.error} />
          <button
            type="button"
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending}
            className="self-start rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {t('billing:credit.confirm')}
          </button>
        </>
      )}
    </section>
  )
}
```

The key is `${paymentId}:${chargeId}`, not `chargeId`: one charge can legitimately be settled from two different payments, and a duplicate React key silently drops a row.

- [ ] **Step 6: Mount it in the ledger section**

In `apps/web/src/billing/ClientLedgerSection.tsx`, import it and render it between the ledger list and `RecordPaymentForm`:

```tsx
      {ledger.data !== undefined && (
        <ApplyCreditForm clientId={clientId} availableCreditCents={ledger.data.availableCreditCents} onApplied={invalidate} />
      )}
```

`invalidate` already refetches `['client-ledger', clientId]`. Extend it so the home page's two consumers see the money move too:

```tsx
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['client-ledger', clientId] })
    // SummaryRow and ReceivablesSection both read this key; spending credit
    // changes what they show.
    void queryClient.invalidateQueries({ queryKey: ['receivables'] })
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/web test -- ClientLedgerSection
pnpm --filter @ledger-hq/web i18n:check
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS everywhere, and `i18n:check` reports no key missing from either locale.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/billing apps/web/src/i18n/locales
git commit -m "feat(web): apply client credit from the ledger

Propose-then-confirm, mirroring RecordPaymentForm. The section renders
nothing when there is no credit, and invalidates the receivables query
so the home page follows the money.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Receivables show gross, credit and net

**Files:**
- Modify: `apps/web/src/billing/api.ts` (`ReceivablesRow`)
- Modify: `apps/web/src/billing/ReceivablesSection.tsx`
- Modify: `apps/web/src/i18n/locales/pt/billing.json`
- Modify: `apps/web/src/i18n/locales/en/billing.json`
- Test: `apps/web/src/billing/ReceivablesSection.test.tsx`

**Interfaces:**
- Consumes: `getReceivables` now returning `grossOutstandingCents` and `creditCents` (Task 6).
- Produces: no new exported symbol. `SummaryRow` is deliberately untouched — it sums `outstandingCents`, which is now the net figure, so the home tile nets itself.

- [ ] **Step 1: Add the i18n keys, both locales**

pt-PT, inside the existing `receivables` block:

```json
    "gross": "Bruto",
    "credit": "Crédito",
```

en-GB, same place:

```json
    "gross": "Gross",
    "credit": "Credit",
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/web/src/billing/ReceivablesSection.test.tsx`, using its existing `renderSection`, `shown` and `getReceivablesMock` helpers:

```ts
describe('client credit', () => {
  it('shows gross and credit beside the net figure when credit is involved', async () => {
    getReceivablesMock.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Padaria Central',
        grossOutstandingCents: 20000,
        creditCents: 15000,
        outstandingCents: 5000,
        oldestDueOn: '2026-05-31',
        ageingBucket: '0-30',
      },
    ])

    renderSection()

    const row = await screen.findByText('Padaria Central')
    expect(row).toBeVisible()
    expect(screen.getByText(shown(formatCurrency(5000, 'pt-PT')))).toBeVisible()
    expect(screen.getByText(shown(formatCurrency(20000, 'pt-PT')))).toBeVisible()
    expect(screen.getByText(shown(formatCurrency(15000, 'pt-PT')))).toBeVisible()
  })

  it('shows only the one figure when there is no credit', async () => {
    getReceivablesMock.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Padaria Central',
        grossOutstandingCents: 20000,
        creditCents: 0,
        outstandingCents: 20000,
        oldestDueOn: '2026-05-31',
        ageingBucket: '0-30',
      },
    ])

    renderSection()

    await screen.findByText('Padaria Central')
    // One amount in the row, plus the list total — never a redundant
    // "gross 200,00 EUR, credit 0,00 EUR" restating the same number twice.
    expect(screen.queryByText(/bruto/i)).toBeNull()
    expect(screen.queryByText(/crédito/i)).toBeNull()
  })

  it('totals the net figures', async () => {
    getReceivablesMock.mockResolvedValue([
      { clientId: 'c1', clientName: 'A', grossOutstandingCents: 20000, creditCents: 15000, outstandingCents: 5000, oldestDueOn: '2026-05-31', ageingBucket: '0-30' },
      { clientId: 'c2', clientName: 'B', grossOutstandingCents: 9000, creditCents: 0, outstandingCents: 9000, oldestDueOn: '2026-01-05', ageingBucket: '90+' },
    ])

    renderSection()

    expect(await screen.findByText(shown(formatCurrency(14000, 'pt-PT')))).toBeVisible()
  })
})
```

Update every existing fixture in that file to carry `grossOutstandingCents` and `creditCents` too — typecheck fails otherwise.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- ReceivablesSection
```

Expected: FAIL — gross and credit are not rendered.

- [ ] **Step 4: Extend the row type**

In `apps/web/src/billing/api.ts`:

```ts
export type ReceivablesRow = {
  clientId: string
  clientName: string
  /** What the client owes before its own unspent money is counted. */
  grossOutstandingCents: number
  /** Unspent payment money, netted off `outstandingCents` notionally. */
  creditCents: number
  /** Net, floored at zero — what this client actually still owes. */
  outstandingCents: number
  oldestDueOn: string
  ageingBucket: AgeingBucket
}
```

- [ ] **Step 5: Render both parts**

In `apps/web/src/billing/ReceivablesSection.tsx`, replace the `value` node of the `DataList.Row`:

```tsx
                value={
                  <>
                    {row.creditCents > 0 && (
                      // Where the net number came from, so nobody has to open
                      // the client to find out why it fell.
                      <span className="text-xs text-muted">
                        {t('receivables.gross')} <Money cents={row.grossOutstandingCents} size="sm" /> ·{' '}
                        {t('receivables.credit')} <Money cents={row.creditCents} size="sm" tone="credit" />
                      </span>
                    )}
                    <Badge tone={AGEING_TONE[row.ageingBucket]}>{t(`receivables.bucket.${row.ageingBucket}`)}</Badge>
                    <Money cents={row.outstandingCents} />
                  </>
                }
```

`Money` already exposes `size="sm" | "md" | "lg"` and `tone="credit"` (`apps/web/src/ui/Money.tsx`), so this needs no change to the component.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/web test -- ReceivablesSection
pnpm --filter @ledger-hq/web i18n:check
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS everywhere.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/billing apps/web/src/i18n/locales
git commit -m "feat(web): show gross and credit beside the net receivable

The home page's outstanding tile needs no change: it sums
outstandingCents, which is now net.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: End-to-end proof, and the documents that are now wrong

**Files:**
- Modify: `apps/web/e2e/billing.spec.ts`
- Modify: `docs/adr/0007-billing-generator-and-view.md:60`
- Modify: `README.md:15-23`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: everything above. Produces nothing new.

- [ ] **Step 1: Write the failing E2E case**

Append a second test to `apps/web/e2e/billing.spec.ts`, reusing that file's sign-in idiom verbatim (the suite runs against one shared backend, so the client name and NIF must be unique to this test):

```ts
test('records an advance payment, sees it as credit, and spends it on a later charge', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel(/email/i).fill('paulo@example.com')
  await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
  const confirmPasswordField = page.getByLabel(/confirma/i)
  if (await confirmPasswordField.isVisible().catch(() => false)) {
    await confirmPasswordField.fill(MASTER_PASSWORD)
  }
  await page.getByRole('button', { name: /criar|entrar/i }).click()
  await expect(page.getByRole('link', { name: /clientes/i })).toBeVisible()

  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Talho do Bairro Crédito, Lda.')
  // Checksum-valid and unused by any other spec in apps/web/e2e (the others
  // take 123456789 and 5014426xx).
  await page.getByLabel(/^nif$/i).fill('507555554')
  await page.getByRole('button', { name: /guardar/i }).click()
  await page.getByRole('button', { name: /guardar/i }).click() // fiscal profile defaults

  const ledger = page.getByRole('region', { name: /^faturação$/i })
  const adHocCharge = ledger.getByRole('form', { name: /nova cobrança avulsa/i })
  const payment = ledger.getByRole('region', { name: /registar pagamento/i })
  const credit = ledger.getByRole('region', { name: /crédito disponível/i })

  // A payment with nothing to settle: every cent becomes credit.
  await payment.getByLabel(/valor \(cêntimos\)/i).fill('27000')
  await payment.getByLabel(/data de receção/i).fill('2026-01-05')
  await payment.getByRole('button', { name: /propor alocação/i }).click()
  await payment.getByRole('button', { name: /^confirmar$/i }).click()

  await expect(credit.getByText(/crédito disponível/i)).toBeVisible()

  // Now give it something to settle, due in the past so it has fallen due.
  await adHocCharge.getByLabel(/descrição/i).fill('Trabalho extra')
  await adHocCharge.getByLabel(/valor \(cêntimos\)/i).fill('9000')
  await adHocCharge.getByLabel(/data de vencimento/i).fill('2026-02-28')
  await adHocCharge.getByRole('button', { name: /^guardar$/i }).click()

  await credit.getByRole('button', { name: /aplicar crédito/i }).click()
  await expect(credit.getByText(/trabalho extra/i)).toBeVisible()
  await credit.getByRole('button', { name: /^confirmar$/i }).click()

  // The debt is settled from credit alone, so the client never appears in
  // receivables — and 180,00 EUR of credit is still on hand.
  await page.getByRole('link', { name: /início|home/i }).click()
  await expect(page.getByText('Talho do Bairro Crédito, Lda.')).toHaveCount(0)
})
```

`507555554` satisfies the checksum rule in `packages/domain/src/identifiers/` and is taken by no other spec. If the suite has grown since this plan was written, `grep -rn "nif" apps/web/e2e/*.spec.ts` lists what is in use; `507666666` and `507777778` are also valid and free.

- [ ] **Step 2: Run the E2E suite against an empty database**

```bash
docker compose exec postgres psql -U ledger -d postgres \
  -c 'DROP DATABASE IF EXISTS ledger_hq_e2e WITH (FORCE)' \
  -c 'CREATE DATABASE ledger_hq_e2e OWNER ledger'
export DATABASE_URL="postgresql://ledger:<password>@localhost:5432/ledger_hq_e2e"
pnpm --filter @ledger-hq/api exec prisma migrate deploy
pnpm --filter @ledger-hq/web test:e2e
```

Expected: PASS, both billing specs. Every spec registers its own client, so this needs the throwaway database, not your development one.

- [ ] **Step 3: Close the gap ADR 0007 recorded**

In `docs/adr/0007-billing-generator-and-view.md`, replace the paragraph beginning **"Known gap, deferred to Phase 4: client credit is not consumed."** with:

```markdown
**Closed in Phase 4a: client credit is now consumed.** This gap — master
spec §8.2 promising that unallocated excess is "consumed automatically in
the next proposal", while nothing ever spent it — is closed by
`docs/superpowers/specs/2026-09-28-phase-4a-client-credit-design.md`.
Credit is derived by a `payment_credits` view, `ProposedAllocation` gained
the `paymentId` it lacked, and the money is spent either when charges are
generated or on demand from the client ledger. The receivables views net it
notionally so the debt is no longer overstated. The `::int` discipline
below applies unchanged to the new view.
```

- [ ] **Step 4: Update the README's phase list**

In `README.md`, extend the sentence listing the implemented phases so Phase 4a is named, and replace the closing clause about section 16 being "Phase 4 material" with a pointer to the decomposition:

```markdown
and **Phase 4a — Client Credit** (unallocated payment excess derived as
credit, netted into the receivables views, and spendable both when charges
are generated and on demand). Phase 4's remaining sub-phases — 4b search
and reporting, 4c obligation attachments — are mapped in
[the Phase 4a design](docs/superpowers/specs/2026-09-28-phase-4a-client-credit-design.md)
(section 2).
```

- [ ] **Step 5: Document the view in the architecture doc**

In `docs/architecture.md`, find the section describing `charge_balances` and add `payment_credits` beside it: what it derives, that it is read through `$queryRaw` because Prisma does not model views, and that credit is never stored. Match the surrounding prose; do not add a new top-level section for one view.

- [ ] **Step 6: Run the full gate**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @ledger-hq/api test:integration
pnpm --filter @ledger-hq/web i18n:check
```

Expected: PASS, all of it.

- [ ] **Step 7: Commit**

```bash
git add apps/web/e2e/billing.spec.ts docs/adr/0007-billing-generator-and-view.md README.md docs/architecture.md
git commit -m "test(web): prove advance payment becomes spendable credit end to end

Also closes the Phase 4 gap ADR 0007 recorded, and updates the README
and architecture doc to match what is now built.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
