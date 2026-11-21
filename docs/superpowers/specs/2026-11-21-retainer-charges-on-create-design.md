# Retainer charges generated on plan create — design

Date: 2026-11-21. Size: small change.

## Intent

The owner is onboarding existing clients and wants to track their payments
from a chosen date in the past (e.g. two months ago). When a retainer plan is
created with that start date, every charge owed since then must exist
immediately, not after the next 03:00 cron run. The start date defaults to
today.

## Current state

- `chargePeriodsSince` already backfills from the period containing
  `validFrom` up to `asOf`, so a back-dated plan does get its arrears — but
  only when `generateCharges` next runs (daily cron or the manual endpoint).
- `createRetainerPlan` / `renewRetainerPlan` only write the plan.
- `validFrom` is required by `createRetainerPlanSchema`; the form's date field
  starts empty.
- Gap: a plan created back-dated and renewed before the cron runs never has
  its own periods generated, because the generator only considers plans still
  in force on `asOf`.

## Goals

- Creating a plan generates its charges at once: every started period from
  the period containing `validFrom` up to today, with credit applied exactly
  as the generator already does.
- Renewing a plan does the same for the new plan.
- `validFrom` defaults to today: pre-filled in the form, optional in the API.

## Non-goals

- No change to period rules: the start period is charged in full (start on
  21/09 bills all of September), as in master spec §8.1 and the obligations
  start rule (c30c0e9).
- No retroactive repricing: renewing with a past `effectiveFrom` does not
  re-bill periods already charged under the old plan (existing client-scoped
  idempotency, unchanged).
- No limit on how far back `validFrom` may go; a future `validFrom` simply
  generates nothing until its period starts.

## Anti-goals

- Plan creation must never fail because charge generation failed.
- No duplicate charges: idempotency stays with the existing label check and
  `@@unique(clientId, planId, periodLabel)`.

## Approaches

- **A. Generate inside the API service (chosen).** After the plan is written,
  `createRetainerPlan` / `renewRetainerPlan` call
  `generateCharges({ clientId, asOf: now }, false)`. Covers every caller, not
  just the UI; reuses the credit sweep. Chosen by the owner.
- B. Frontend calls `generate-charges` after save. Two requests; rule lives
  only in the UI.
- C. Plan and charges in one transaction. Would split `generateCharges`, which
  deliberately separates charge creation from credit application (ADR 0007).

## Design

- `createRetainerPlanSchema.validFrom` becomes optional; the service defaults
  it to today (UTC date).
- After the plan write commits, the service runs `generateCharges` scoped to
  the client. A failure there is logged and swallowed — the plan stands and
  the nightly cron heals it. Response shape unchanged.
- Same for `renewRetainerPlan`, after its transaction commits.
- Form: date field initialised to today (local date, `YYYY-MM-DD`). The card
  already invalidates the client ledger and receivables on save, so new
  charges show without further UI work.
- Master spec §8.1 gains one line: charges are also generated when a plan is
  created or renewed.

## Left to the builder

- Where the "today" helper lives (domain vs. service) and test layout,
  following existing billing tests (unit + integration + form test).
