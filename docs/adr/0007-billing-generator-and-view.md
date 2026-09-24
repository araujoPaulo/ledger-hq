# 7. Billing: no retraction, and an explicit `::int` cast discipline

## Status

Accepted.

## Context

Phase 3 mirrors Phase 2's obligation-engine shape (generator, resolver,
read views) for billing, per the design doc
(`docs/superpowers/specs/2026-09-17-phase-3-billing-design.md`). Two
decisions came up during implementation that the master spec's prose
(sections 6.6 and 8) does not fully resolve on its own.

## Decision 1: the charge generator has no retraction step

The obligation generator retracts a `PENDING` instance whose rule no longer
applies (`obligations.service.ts`'s `toRetract`, guarded so it never touches
a period that has already ended — a real bug found and fixed during Phase
2's own review). Billing's `generateCharges` has no equivalent step at all:
once a `RetainerPlan` closes, `chargePeriodsSince` simply stops producing
periods past its `validTo`, and every charge already created for an earlier
period is real, already-issued debt that must never disappear merely
because the plan later closed. There is nothing to retract — the
generator's only job is creating what is missing, never removing what
exists.

This is also why the generator has no forward horizon, where the obligation
generator has one: an obligation is a deadline you want to see coming, a
charge is a debt that only exists once its period has started.

## Decision 2: every raw-SQL aggregate is cast `::int` explicitly

Postgres's `SUM()`/`COUNT()` over an `Int` column returns `bigint`.
`prisma.$queryRaw` hands that back as a JavaScript `bigint`, which NestJS's
default JSON serializer throws on. The `charge_balances` view casts every
aggregate at its source:

```sql
COALESCE(SUM(a."amountCents"), 0)::int AS "allocatedCents",
(c."amountCents" - COALESCE(SUM(a."amountCents"), 0))::int AS "outstandingCents",
```

so every consumer inherits a plain, JSON-safe `number` without needing to
remember the cast itself. The two queries that aggregate *across* the view
— `getReceivables`'s `SUM(b."outstandingCents")::int` and
`getCurrentMonth`'s `COALESCE(SUM(...), 0)::int` — repeat it anyway,
because a `SUM` over an already-cast `int` column is itself a fresh
`bigint`. The rule is therefore per-aggregate, not per-column: every
`SUM`/`COUNT` written in raw SQL in this codebase carries its own `::int`.

## Consequences

A future feature that needs to know *why* a charge stopped being generated
(as distinct from a charge that simply has not been created yet) would need
a new signal — nothing in this schema currently distinguishes "plan closed
before this period" from "plan never existed for this period". Nothing in
this phase's scope needs it; worth remembering if it is ever raised.

**Known gap, deferred to Phase 4: client credit is not consumed.** Master
spec §8.2 says unallocated payment excess "functions as client credit,
consumed automatically in the next proposal". The excess is recorded — it
stays unallocated on the `Payment` row — but nothing ever spends it: the
proposal reads `charge_balances` only, so a client who pays a quarter in
advance still shows the full next charge as outstanding. Closing this means
changing the allocation contract, because `ProposedAllocation` carries only
a `chargeId` and an amount, with no way to say which earlier payment an
allocation is drawn from. The money is not lost, only invisible, and the
operator can still allocate it by hand.

The `::int` discipline is a convention, not a constraint the database
enforces: a new raw-SQL aggregate that forgets the cast fails at
serialization time, in the response, not at migration time. The
view's own constraint test asserts `typeof outstandingCents === 'number'`,
which catches a regression on that one column; `allocatedCents` has no
equivalent assertion.
