# Retainer Charges on Plan Create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Creating or renewing a retainer plan immediately generates every charge owed from the plan's start period up to today; the start date defaults to today.

**Architecture:** `BillingService.createRetainerPlan` / `renewRetainerPlan` call the existing `generateCharges({ clientId, asOf: new Date() }, false)` after the plan write commits, through a private helper that logs and swallows failures. `validFrom` becomes optional in the domain schema and defaults to today in the service. The web form pre-fills today.

**Tech Stack:** NestJS 12 + Prisma (apps/api), zod (packages/domain), React + TanStack Query + Vitest/Testing Library (apps/web), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-11-21-retainer-charges-on-create-design.md`

## Global Constraints

- Plan create/renew must never fail because charge generation failed; the nightly cron heals it.
- No duplicate charges: idempotency stays with `generateCharges`' client-scoped label check and `@@unique(clientId, planId, periodLabel)`. Do not touch `generateCharges` or `chargePeriodsSince`.
- Start period is charged in full (master spec §8.1).
- Response shapes of `POST /billing/clients/:clientId/retainer-plan` and `/renew` are unchanged.
- "Today" is `new Date().toISOString().slice(0, 10)` everywhere (existing convention: `isoDate` in `billing.service.ts`, `FiscalProfileForm.tsx`).
- Work on branch `feat/retainer-charges-on-create`, never `master`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Back-dated create, then renew the same day at a new fee: the closed plan's periods must already exist at the old amount, the new plan must not re-bill them. Test: Task 2, `keeps the closed plan's charges when a back-dated plan is renewed`.
2. Client who already has credit (payment recorded before the plan): credit is spent against the newly generated charges, oldest first. Test: Task 2, `spends existing credit against the charges it generates`.
3. `validFrom` in the future: plan created, zero charges, no error. Test: Task 2, `creates no charge for a plan starting next month`.
4. Generation throws: create still returns the plan. Test: Task 2 unit, `still returns the plan when charge generation fails`.
5. Form opened and saved without touching the date: sends today. Test: Task 3, `pre-fills the start date with today`.

---

### Task 1: `validFrom` optional, defaulting to today

**Files:**
- Modify: `packages/domain/src/schemas/billing.ts:24-31`
- Modify: `apps/api/src/billing/billing.service.ts:225-240` (`createRetainerPlan`)
- Modify: `apps/web/src/billing/api.ts:118-123` (`validFrom?: string`)
- Test: `packages/domain/src/schemas/billing.test.ts`, `apps/api/src/billing/billing.service.test.ts`

**Interfaces:**
- Produces: `CreateRetainerPlanInput.validFrom?: string` (ISO date). `createRetainerPlan` stores `validFrom` as `new Date(\`${input.validFrom ?? isoDate(new Date())}T00:00:00Z\`)`.

- [ ] **Step 1: Write the failing tests**

In `billing.test.ts`, `describe('createRetainerPlanSchema')`:

```ts
it('accepts a plan with no validFrom — the service defaults it to today', () => {
  expect(createRetainerPlanSchema.safeParse({ amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8 }).success).toBe(true)
})
```

In `billing.service.test.ts`, `describe('BillingService#createRetainerPlan')`:

```ts
it('defaults validFrom to today when omitted', async () => {
  const prisma = fakePrisma()
  const service = new BillingService(prisma, fakeClientsService(client))
  const today = new Date().toISOString().slice(0, 10)

  const plan = await service.createRetainerPlan('c1', { amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8 })

  expect(plan.validFrom).toEqual(new Date(`${today}T00:00:00Z`))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ledger-hq/domain test -- billing && pnpm --filter @ledger-hq/api test -- billing.service`
Expected: FAIL. Schema rejects the missing `validFrom`; the service test fails to compile or gets `Invalid Date`.

- [ ] **Step 3: Implement**

`validFrom: isoDateSchema.optional()` in `createRetainerPlanSchema`; service uses `input.validFrom ?? isoDate(new Date())`; web `createRetainerPlan` input type gets `validFrom?: string`.

- [ ] **Step 4: Run tests to verify they pass**

Run: same as Step 2, then `pnpm typecheck`.
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/schemas/billing.ts packages/domain/src/schemas/billing.test.ts apps/api/src/billing/billing.service.ts apps/api/src/billing/billing.service.test.ts apps/web/src/billing/api.ts
git commit -m "feat(billing): default a retainer plan's validFrom to today"
```

---

### Task 2: Generate charges on plan create and renew

**Files:**
- Modify: `apps/api/src/billing/billing.service.ts` (`createRetainerPlan`, `renewRetainerPlan`, new private helper)
- Test: `apps/api/src/billing/billing.service.test.ts`, `apps/api/test/billing.integration.test.ts`

**Interfaces:**
- Consumes: `generateCharges(input: { asOf: Date; clientId?: string }, dryRun: boolean): Promise<GenerateChargesResult>` (existing); `this.logger` (existing).
- Produces: `private async generateChargesAfterPlanChange(clientId: string): Promise<void>`. Calls `this.generateCharges({ asOf: new Date(), clientId }, false)`; on throw, `this.logger.error(\`generateChargesAfterPlanChange: failed for client ${clientId}\`, stack)` and returns. Called after the plan write in `createRetainerPlan`, and after the `$transaction` resolves in `renewRetainerPlan` (never inside it). Both keep their current return values.

- [ ] **Step 1: Write the failing unit tests**

In `billing.service.test.ts`:

```ts
// describe('BillingService#createRetainerPlan')
it('generates the client\'s charges right after creating the plan', async () => {
  const service = new BillingService(fakePrisma(), fakeClientsService(client))
  const generate = vi.spyOn(service, 'generateCharges').mockResolvedValue({ toCreate: [], creditToAllocate: [], created: 0, allocated: 0 })

  await service.createRetainerPlan('c1', { amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-09-01' })

  expect(generate).toHaveBeenCalledWith({ asOf: expect.any(Date), clientId: 'c1' }, false)
})

it('still returns the plan when charge generation fails', async () => {
  const service = new BillingService(fakePrisma(), fakeClientsService(client))
  vi.spyOn(service, 'generateCharges').mockRejectedValue(new Error('boom'))

  const plan = await service.createRetainerPlan('c1', { amountCents: 9000, periodicity: 'MONTHLY', dueDayOfMonth: 8, validFrom: '2026-09-01' })

  expect(plan).toMatchObject({ clientId: 'c1', amountCents: 9000 })
})

// describe('BillingService#renewRetainerPlan')
it('generates the client\'s charges after the renewal commits', async () => {
  // same fakePrisma setup as 'creates a plan directly, with no closedPlanId…'
  // spy generateCharges; assert toHaveBeenCalledWith({ asOf: expect.any(Date), clientId: 'c1' }, false)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @ledger-hq/api test -- billing.service`
Expected: the two "generates…" tests FAIL (`generateCharges` not called). "still returns the plan" passes already. That is fine, it guards the helper.

- [ ] **Step 3: Implement `generateChargesAfterPlanChange` and call it from both methods**

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `pnpm --filter @ledger-hq/api test -- billing.service`
Expected: PASS.

- [ ] **Step 5: Write the integration tests**

Add to `billing.integration.test.ts` a helper and a new `describe('retainer plan create/renew generates charges')`. The real clock drives `asOf`, so dates are relative to now:

```ts
/** First day of the current UTC month shifted by `offset` months: { iso: 'YYYY-MM-01', label: 'YYYY-MM' }. */
function monthStart(offset: number): { iso: string; label: string }
```

Tests (use `post(...)` against the HTTP routes, `dueDayOfMonth: 1` so every started period is already due):

- `generates every period from the start month on create`: plan `validFrom: monthStart(-2).iso`, amount 9000. Expect 3 RETAINER charges, labels `[monthStart(-2).label, monthStart(-1).label, monthStart(0).label]` (ordered by `periodLabel`), each 9000.
- `defaults to today and charges the current month when validFrom is omitted`: no `validFrom`. Expect plan `validFrom` = today, and exactly 1 charge with label `monthStart(0).label`.
- `creates no charge for a plan starting next month`: `validFrom: monthStart(1).iso`. Expect 201 and 0 charges.
- `keeps the closed plan's charges when a back-dated plan is renewed`: create at `monthStart(-2).iso`, 9000. Renew `{ newAmountCents: 12000, effectiveFrom: monthStart(-1).iso }`. Expect still 3 charges total, all 9000, one per label.
- `generates charges on renew for a client with no plan yet`: renew `{ newAmountCents: 12000, effectiveFrom: monthStart(-1).iso, dueDayOfMonth: 1 }` on a fresh client. Expect 2 charges of 12000.
- `spends existing credit against the charges it generates`: `billing.recordPayment({ clientId, amountCents: 9000, receivedOn: monthStart(-1).iso, method: 'TRANSFER', allocations: [] })`, then create plan at `monthStart(-1).iso`, 9000. Expect one `paymentAllocation` of 9000 on the `monthStart(-1).label` charge, none on `monthStart(0).label`.

The existing tests at lines 189-221 and 306-320 now also generate charges (from `2026-01-01`). Their assertions only look at plans, so they should pass unchanged. Confirm, don't edit them.

- [ ] **Step 6: Run integration tests**

Run: `docker compose up -d postgres && pnpm --filter @ledger-hq/api test:integration -- billing`
Expected: PASS, including every pre-existing billing integration test.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/billing/billing.service.ts apps/api/src/billing/billing.service.test.ts apps/api/test/billing.integration.test.ts
git commit -m "feat(billing): generate retainer charges when a plan is created or renewed"
```

---

### Task 3: Form pre-fills today; e2e and spec follow the new behaviour

**Files:**
- Modify: `apps/web/src/billing/RetainerPlanForm.tsx:21`
- Test: `apps/web/src/billing/ledgerCards.test.tsx` (`describe('RetainerPlanCard')`)
- Modify: `apps/web/e2e/billing.spec.ts:50-110`
- Modify: `docs/superpowers/specs/2026-09-04-ledger-hq-design.md` §8.1

**Interfaces:**
- Consumes: `createRetainerPlan` input from Task 1 (the form still always sends `validFrom`).

- [ ] **Step 1: Write the failing test and adapt existing ones**

New test:

```ts
it('pre-fills the start date with today', async () => {
  getCurrentRetainerPlan.mockResolvedValue(null)
  createRetainerPlan.mockResolvedValue(plan)
  renderWith(<RetainerPlanCard clientId="c1" onSaved={() => {}} />)
  await userEvent.click(await screen.findByRole('button', { name: /criar plano de retainer/i }))
  const dialog = await screen.findByRole('dialog', { name: /criar plano de retainer/i })
  const today = new Date().toISOString().slice(0, 10)

  expect(within(dialog).getByLabelText(/em vigor desde/i)).toHaveValue(today)
  await userEvent.type(within(dialog).getByLabelText(/valor mensal/i), '90,00')
  await userEvent.click(within(dialog).getByRole('button', { name: /^guardar$/i }))

  await waitFor(() => expect(createRetainerPlan).toHaveBeenCalledWith('c1', expect.objectContaining({ validFrom: today })))
})
```

The existing tests that `userEvent.type` a date into `/em vigor desde/i` and `/a partir de/i` must `userEvent.clear(...)` that field first, because it is no longer empty. Same for any "cannot be saved without…" test that relies on an empty date. Read each test and adjust it so it still checks what it checked before.

- [ ] **Step 2: Run to verify the new test fails**

Run: `pnpm --filter @ledger-hq/web test -- ledgerCards`
Expected: `pre-fills the start date with today` FAILS (value `''`).

- [ ] **Step 3: Implement**

`useState(() => new Date().toISOString().slice(0, 10))` for `effectiveDate`. Applies to create and renew.

- [ ] **Step 4: Run web tests**

Run: `pnpm --filter @ledger-hq/web test`
Expected: PASS.

- [ ] **Step 5: Rewrite the e2e flow around generated charges**

The current spec creates a plan from `2026-01-01`, then pays an ad-hoc charge, because "the plan only produces charges when the cron runs". That premise is gone. With this change it would generate a charge per month since January, and the 150,00 payment would no longer clear receivables. Replace lines 50-110 so that:
- The plan is created with `validFrom` = first day of the previous UTC month (computed in the test), monthly 90,00, `dueDayOfMonth` 1. That gives exactly two due charges.
- The ledger shows `Retainer — <prev YYYY-MM>` and `Retainer — <current YYYY-MM>` right after saving.
- The client appears in receivables. A payment of 180,00 dated today proposes both charges. Confirm, and the client clears from receivables.
- Drop the ad-hoc charge step and its comment. Ad-hoc creation stays covered by the integration test `creates an ad-hoc charge`.

- [ ] **Step 6: Run e2e**

Run: `pnpm --filter @ledger-hq/web test:e2e -- billing`
Expected: PASS.

- [ ] **Step 7: Update master spec §8.1**

Under "Runs on the same daily cron as the obligation generator.", add a bullet: "Also runs for the client right after a plan is created or renewed, so a back-dated plan's arrears exist immediately. A failure there never fails the plan write; the cron heals it."

- [ ] **Step 8: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/billing/RetainerPlanForm.tsx apps/web/src/billing/ledgerCards.test.tsx apps/web/e2e/billing.spec.ts docs/superpowers/specs/2026-09-04-ledger-hq-design.md
git commit -m "feat(web): pre-fill a retainer plan's start date with today"
```
