# Phase 3 — Billing Design

- **Date:** 2026-09-17
- **Status:** Approved
- **Author:** Design session with the product owner

## 1. Context

The master spec (`docs/superpowers/specs/2026-09-04-ledger-hq-design.md`, §6.6 and
§8) already settles the hard parts of Phase 3: the Prisma schema
(`RetainerPlan`, `Charge`, `Payment`, `PaymentAllocation`), the charge
generator, the FIFO allocation strategy, the `charge_balances` view, and the
three read views (per-client, global, current-month). This document does not
repeat those decisions — it resolves what the master spec leaves open: API
shape, module layout, UI flows, and testing, so an implementation plan can be
written directly from it. Same relationship Phase 2's design doc had to the
master spec's obligation-engine section.

Phase 3 answers the third recurring problem from the master spec's context
(§1.3): "who has paid the current month, and who is several months behind,"
currently reconstructed by memory.

## 2. Scope

In scope: retainer plans, charge generation, ad-hoc (`EXTRA`) charges, payment
recording, allocation, write-off, the three billing views, and their
integration into the existing home page and per-client page from Phase 1/2.

Out of scope, per the master spec's non-goals (§3): invoice or receipt
issuance, splitting taxable base from VAT (§8.1's stated assumption — gross
amount only), and multi-currency (implicit — the whole system is EUR-only,
`amountCents` as `Int`).

## 3. Decisions this design makes that the master spec leaves open

### 3.1 Charge generation: dry-run + diff, same discipline as the obligation generator

The master spec's `generateCharges({ asOf })` (§8.1) is described as a plain
call. Phase 2 established a two-step pattern for its generator — preview,
then apply — specifically so a write the owner didn't ask for right now never
happens silently. Charge generation gets the same shape, even though it is
individually simpler (one `Charge` per in-force plan per elapsed period, no
catalog-matching ambiguity to review):

```
POST /billing/generate-charges?dryRun=true|false
  -> { toCreate: [{ clientId, clientName, planId, periodLabel, amountCents, dueOn }] }  (dryRun=true)
  -> { created: number }                                                                (dryRun=false)
```

Defaults to `dryRun=true` when the query param is omitted, mirroring the
Phase 2 ruling that a write endpoint must never apply by default (see Phase 2
plan, Task 11's preflight note). The daily cron always calls it with
`dryRun=false` explicitly.

### 3.2 Payment recording is also two-step: propose, then confirm

The master spec's flow (§8.2) already narrates two steps — the system
proposes, the owner confirms or redistributes — but doesn't give it an API
shape. Two endpoints, not one:

```
POST /billing/payments/propose-allocation
  body: { clientId, amountCents, receivedOn, method, reference? }
  -> { proposed: [{ chargeId, description, periodLabel, dueOn, amountCents }], excessCents }

POST /billing/payments
  body: { clientId, amountCents, receivedOn, method, reference?, allocations: [{ chargeId, amountCents }] }
  -> { paymentId }
```

Nothing is persisted by the first call — it's `proposeAllocation` (the pure
function from §8.2) run against the current `charge_balances`. The second
call is what a confirm screen submits: the owner may have edited amounts away
from the proposal (deliberately leaving current-month unpaid to highlight
arrears, the exact scenario §8.2 calls out), so the server re-validates
rather than trusting the client: sum of allocations ≤ `amountCents`, each
allocation ≤ that charge's current outstanding balance, atomically with the
`Payment` row in one transaction.

### 3.3 Retainer fee changes: one action, not two manual steps

`RetainerPlan` is immutable-once-closed by design (§6.6) — a fee increase
closes the old plan (`validTo`) and opens a new one, so 2025 charges keep
2025 prices. Exposing that as two separate manual operations (close, then
remember to create) invites the exact mistake the immutability was meant to
prevent: a gap with no plan in force. One endpoint does both in a
transaction:

```
POST /billing/clients/:clientId/retainer-plan/renew
  body: { newAmountCents, effectiveFrom, periodicity?, dueDayOfMonth? }
  -> { closedPlanId, newPlanId }
```

Server sets the closed plan's `validTo = effectiveFrom - 1 day` and creates
the successor with `validFrom = effectiveFrom`. The `EXCLUDE USING gist`
constraint (§6.6) is the backstop, not the primary defense — this endpoint is
the only write path to `RetainerPlan` after its first creation, so the
constraint should never actually fire outside a bug.

Creating a client's *first* plan is a separate, simpler endpoint (no plan to
close): `POST /billing/clients/:clientId/retainer-plan`.

### 3.4 Dashboard placement: a second section on the existing home page

Phase 2 made `ObligationsDashboard` the app's home page, grouped by urgency.
Billing's global view (§8.4, receivables with ageing buckets) answers the
other half of "what needs my attention today" — not a separate concern
requiring separate navigation. The home page gains a second section below
obligations:

```
┌─ Obligations (Phase 2, unchanged) ─────────────┐
│  Overdue · This week · This month · Later      │
├─ Receivables ───────────────────────────────────┤
│  0-30 · 31-60 · 61-90 · 90+ (worst bucket first)│
│  each row: client, outstanding, months in       │
│  arrears, oldest overdue charge's dueOn         │
└──────────────────────────────────────────────────┘
```

Both sections are independently loading `useQuery`s against their own
endpoints (`GET /obligations` grouped client-side, `GET /billing/receivables`
already bucketed server-side — bucketing needs `asOf`, which the ageing
window depends on, so it's computed server-side rather than duplicating
`groupByUrgency`'s client-side pattern). Neither section knows the other
exists, matching the master spec's module-boundary rule (§5.2: "any view that
combines obligations and debt belongs in `reporting`, never in a lateral
dependency") — the *page* combines them, the *modules* stay ignorant of each
other.

### 3.5 API shape for the two remaining views

```
GET /billing/receivables                    -> global dashboard section (3.4)
GET /billing/current-month                  -> { clients: [{ clientId, name, paid: boolean, outstandingCents }] }
GET /billing/clients/:clientId/ledger       -> { entries: [{ type: 'CHARGE'|'PAYMENT', ...,  runningBalanceCents }], balanceCents }
```

`current-month` is its own endpoint rather than a filter on `receivables`
because the two questions are shaped differently: receivables cares about
everyone who owes *anything, from any period*; current-month cares about
everyone with an active plan, whether or not this month's charge exists yet
or is settled. Forcing one endpoint to answer both invites exactly the kind
of conditional-shaped response that made Phase 2 reject a bespoke dashboard
endpoint in favor of one flexible list (Phase 2 design §3.2) — here the
inverse holds because the two queries genuinely don't share a shape.

### 3.6 Ad-hoc charges and write-off follow the Phase 2 pattern exactly

`EXTRA` charges get an `AddAdHocChargeForm` on the per-client billing
section, structurally identical to Phase 2's `AddAdHocObligationForm`
(description, amount, due date — no catalog, no plan). Write-off requires a
reason, structurally identical to Phase 2's `WAIVED` status:

```
PATCH /billing/charges/:id/write-off
  body: { reason }
```

New `ErrorCode` entries follow the same naming convention as Phase 2's:
`'billing.write_off_reason_required'`, `'billing.allocation_exceeds_payment'`,
`'billing.allocation_exceeds_charge_balance'`.

### 3.7 i18n split

Same split as Phase 2 (design §3.5): no catalog to translate here (billing
has no catalog), so all billing strings — form labels, ledger entry types,
ageing bucket names, error messages — live in `billing.json`, already
reserved in the master spec's namespace list (§9, repository i18n tree).
Enum values (`ChargeKind`, `PaymentMethod`) live in the `domain` namespace
alongside obligation statuses, per the master spec's existing convention.

## 4. Data model

Unchanged from the master spec (§6.6) — reproduced here only as a pointer,
not a redefinition:

- `RetainerPlan` — time-bounded, `EXCLUDE USING gist` prevents overlap. Needs
  the `btree_gist` Postgres extension, not yet enabled in this database —
  the migration must `CREATE EXTENSION IF NOT EXISTS btree_gist` before
  adding the constraint.
- `Charge` — `kind: RETAINER | EXTRA`, `@@unique([clientId, planId,
  periodLabel])` for retainer idempotency (`EXTRA` charges have `planId:
  null`, so the unique constraint never applies to them).
- `Payment` / `PaymentAllocation` — the allocation table is what makes a
  partial or spanning payment representable at all (§6.6's own justification,
  unchanged).
- `charge_balances` view — derives `status` (`OPEN`/`PARTIAL`/`SETTLED`/
  `WRITTEN_OFF`) and `outstandingCents`. No `status` column on `Charge`
  itself, same "derive, don't store" principle as obligations' `overdue`.

Two new domain enums (`packages/domain/src/enums.ts`, same file Phase 2
extended): `CHARGE_KIND_VALUES` (`RETAINER`, `EXTRA`), `PAYMENT_METHOD_VALUES`
(`TRANSFER`, `CASH`, `DIRECT_DEBIT`, `OTHER`).

## 5. Module layout

Mirrors Phase 2's obligations module shape exactly:

```
packages/domain/src/billing/
  types.ts            ChargeBalance, ProposedAllocation, LedgerEntry
  allocate.ts          proposeAllocation (pure, FIFO) — the §8.2 core function
  allocate.test.ts      example + property tests (§6, below)

apps/api/src/billing/
  billing.controller.ts
  billing.service.ts      generateCharges, recordPayment, writeOff, renewPlan
  billing.module.ts        registers the module, wired into the same daily
                            cron as ObligationsCron (§8.1: "runs on the same
                            daily cron")
  dto/*.zod.ts             request schemas, parameter-level @Body(new
                            ZodValidationPipe(...)) per the Phase 2 controller
                            convention (method-level @UsePipes validates every
                            handler parameter — ruled out during Phase 1)

apps/web/src/billing/
  api.ts
  ReceivablesSection.tsx        home page, second section (§3.4)
  CurrentMonthWidget.tsx        optional, if the current-month view earns a
                                 spot beyond the per-client ledger — deferred
                                 to the implementation plan to size
  ClientLedgerSection.tsx       per-client page, chronological ledger (§3.5)
  RecordPaymentForm.tsx         propose → confirm flow (§3.2)
  RenewRetainerPlanForm.tsx     single-action fee change (§3.3)
  AddAdHocChargeForm.tsx        EXTRA charge (§3.6)
```

`proposeAllocation` lives in `packages/domain`, not `apps/api`, for the same
reason the obligation resolver does: it's pure, and the web client can run
the identical proposal client-side for an instant preview before the network
round-trip confirms it — not required for v1, but free once the function is
side-effect-free and shared.

## 6. Testing

- `allocate.test.ts` — example-based (partial payment, one payment spanning
  several charges, excess becoming credit, write-off of a partially paid
  charge — the exact cases §8.5 names) plus property tests: allocations never
  exceed the payment, never exceed the charge, and
  `charges - allocations = balance` holds for every generated case.
- `billing.service` integration tests (Testcontainers, same pattern as
  Phase 1/2): idempotency of `generateCharges` (ten runs, one result), the
  `EXCLUDE USING gist` constraint actually rejects an overlapping plan,
  `renewPlan`'s transaction leaves no gap and no overlap.
- E2E: record a payment spanning two months, confirm the receivables section
  and the per-client ledger both reflect it — same "prove it end to end
  offline-safe" bar Phase 1's E2E set, though billing has no offline
  requirement of its own (writes are `NetworkOnly` for every module, per the
  master spec's PWA caching rule, §9.7).

## 7. Risks carried over from the master spec (§15)

No new risk beyond what's already tracked there. One operational note not
previously called out: enabling `btree_gist` is a one-time migration step on
the production Postgres instance, not just the dev container — worth
confirming during the Task 8-equivalent (schema + migration) task that the
extension is available on the target Postgres 18 image before the migration
is written to depend on it.

## 8. Open questions

1. Should the current-month view be its own dashboard widget or folded into
   the per-client ledger as a default filter? Left to the implementation
   plan to size once the receivables section's layout is built and there's a
   concrete home page to judge it against.
2. `amountCents` gross-only (§8.1's stated assumption, carried over
   unchanged): still open per the master spec's own open question #1 — not
   re-opened here, but noted as still live.
