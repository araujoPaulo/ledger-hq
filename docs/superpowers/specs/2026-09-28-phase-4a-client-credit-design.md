# Phase 4a — Client Credit Design

- **Date:** 2026-09-28
- **Status:** Approved
- **Author:** Design session with the product owner

## 1. Context

The master spec (`docs/superpowers/specs/2026-09-04-ledger-hq-design.md`) gives
Phase 4 one table row — "Consolidation: cross-module reporting, global search,
ergonomics" (§14) — plus two open questions (§16) and one gap recorded during
Phase 3 (ADR 0007). Unlike Phases 2 and 3, whose hard parts the master spec had
already settled, Phase 4's content has to be built rather than read off.

A design session established that four things hurt in real use: finding
records across modules, advance payments being invisible, the absence of a
cross-module view, and having nowhere to keep submission receipts. Those are
four independent subsystems, not one, so Phase 4 decomposes (§2) and this
document specifies only the first.

Phase 4a closes the gap ADR 0007 recorded: unallocated payment excess is stored
but never spent. The master spec (§8.2) says the excess "functions as client
credit, consumed automatically in the next proposal"; today nothing reads it,
so a client who pays a quarter in advance still shows the full next charge as
outstanding.

## 2. Phase 4 decomposition

Each sub-phase gets its own spec, plan and implementation cycle, in this order:

| Sub-phase | Delivers | Why here |
|---|---|---|
| **4a — Client credit** | Credit derived, netted into the receivables views, consumable at charge generation and on demand | Smallest blast radius, no new module, and it is a correctness gap rather than a new feature |
| **4b — Search and reporting** | Global search and cross-module reporting | Both are cross-module read layers over the same data; designed apart they become two half-designs |
| **4c — Obligation attachments** | Submission receipts stored against completed obligations | New storage subsystem; its storage, backup and encryption decision is independent and blocks nothing before it |

4b and 4c are recorded here so the shape of Phase 4 is visible; neither is
specified by this document, and neither may be implemented from it.

One constraint worth recording now, because it constrains 4b rather than 4a:
server-side search cannot see credential contents. The vault is zero-knowledge
(§9), so the server holds ciphertext it has no key for. Global search covers
clients, platforms, obligations and charges; credential secrets are searchable
only client-side, after unlock, if at all.

## 3. Scope

In scope: deriving credit from unallocated payments, consuming it through the
existing propose/confirm discipline, netting it into the receivables list and
the home page total, and showing it on the client ledger.

Out of scope: refunding or cancelling credit with a reason (the write-off
equivalent for money received in excess) — there is no current case for it, and
adding it would need its own audit story; credit transferred between clients;
splitting taxable base from VAT (master spec §16.1, still open, not re-opened
here); and everything in 4b and 4c.

## 4. Decisions

### 4.1 Credit is derived, never stored

A `payment_credits` view mirrors the `charge_balances` view Phase 3 built:

```sql
CREATE VIEW payment_credits AS
SELECT
  p.id                                                        AS "paymentId",
  p."clientId",
  p."receivedOn",
  p."amountCents",
  COALESCE(SUM(a."amountCents"), 0)::int                       AS "allocatedCents",
  (p."amountCents" - COALESCE(SUM(a."amountCents"), 0))::int   AS "creditCents"
FROM "Payment" p
LEFT JOIN "PaymentAllocation" a ON a."paymentId" = p.id
GROUP BY p.id;
```

Every aggregate carries its own `::int`, per ADR 0007's rule — a `SUM` over an
already-cast column is a fresh `bigint`, so consumers that aggregate across
this view repeat the cast.

The two alternatives were considered and rejected. An explicit `CreditNote`
entity would give per-credit audit history, but the audit trail already exists:
every consumption of credit is a `PaymentAllocation` row naming its source
payment and destination charge. It would also create a second place where the
same money lives, which can diverge. Representing credit as a negative-amount
`Charge` would reuse FIFO for free but poisons `charge_balances`, the ageing
buckets and the `@@unique([clientId, planId, periodLabel])` constraint, and
makes a payment look like debt.

No schema change, no data migration: one SQL-only migration adding the view.

### 4.2 `proposeAllocation` takes sources, not an amount

`PaymentAllocation` already carries `paymentId`; the gap is in the DTO, which
names only a destination:

```ts
// before
export type ProposedAllocation = { chargeId: string; amountCents: number }
export function proposeAllocation(paymentAmountCents: number, openCharges: ChargeBalance[]): ProposedAllocation[]

// after
export type ProposedAllocation = { paymentId: string; chargeId: string; amountCents: number }
export type AllocationSource = { paymentId: string; availableCents: number; receivedOn: Date }
export function proposeAllocation(sources: AllocationSource[], openCharges: ChargeBalance[]): ProposedAllocation[]
```

FIFO now runs in two dimensions: charges oldest `dueOn` first, as today, and
sources oldest `receivedOn` first, so the oldest credit is spent before newer
credit. Recording a new payment becomes the special case of a single source.

The function stays pure and stays in `packages/domain`, for the reason §5 of the
Phase 3 spec gives: the web client can run the identical proposal locally.

`receivedOn` is a `Date`, not a string, matching the existing convention in
`packages/domain/src/billing/types.ts`.

### 4.3 Two write paths, both confirm before applying

The master spec's rule that "the proposal is never applied automatically"
(§8.2) holds for credit too. But read literally, "consumed in the next
proposal" only fires when a new payment arrives — which is exactly the case
that hurts: a client pays a quarter up front, sends nothing for two months, the
generator creates the monthly charges, and they sit outstanding beside unspent
credit. So credit is consumable at two moments:

```
POST /billing/generate-charges?dryRun=true
  -> { toCreate: [...], creditToAllocate: ProposedAllocation[] }
POST /billing/generate-charges?dryRun=false
  -> { created: number, allocated: number }     // charges committed, then allocations spent, in two separate transactions — see below

POST /billing/clients/:clientId/apply-credit?dryRun=true|false
  -> { proposed: ProposedAllocationRow[], remainingCreditCents: number }   (dryRun=true)
  -> { allocated: number }                                                 (dryRun=false)
```

`generate-charges` keeps its existing default of `dryRun=true`; the daily cron
already calls it with `dryRun=false` explicitly and now applies credit in the
same run. `apply-credit` is the manual path on the client ledger, for credit
that predates a charge the generator did not create — an `EXTRA` charge, most
often. It reuses `recordPayment`'s propose-then-confirm shape without a new
payment.

`apply-credit` proposes against that one client's open charges only. Credit is
per client; nothing in this design moves money between clients.

**The transaction boundary is two transactions, by design, not one.** An
earlier draft of this section put charge creation and credit application in
one transaction. The implementation deliberately does not: charges are
committed in their own transaction first, and credit is spent against them
afterward, outside it. Charges are the statement of debt and must land even
if spending credit against them fails for any reason; the credit application
is a convenience that can always be retried later from the ledger (via
`apply-credit`) or on the next `generate-charges` run. A client whose credit
cannot be spent this run must still get its charges — rolling both back
together would instead let a credit-side failure erase debt that is real and
already earned. See also `billing.service.ts`'s own comment at the
transaction boundary, and the per-client `try`/`catch` around the credit
sweep loop, which exists for the same reason: one client's credit failure
must not stop every other client's sweep in the same run.

### 4.4 Receivables net credit, and show both parts

`getReceivables` gains two fields:

```ts
{ clientId, clientName, grossOutstandingCents, creditCents, outstandingCents, oldestDueOn, ageingBucket }
```

`outstandingCents` is the net figure, floored at zero — a client with more
credit than debt owes nothing, never a negative amount. `grossOutstandingCents`
and `creditCents` are carried alongside so the operator can see where the net
number came from without opening the client. The home page total sums the net
figure.

**The netting is notional.** It writes no allocations. Money only moves through
§4.3's two confirmed paths; this view merely stops overstating debt.

**Ageing follows the notional netting.** `oldestDueOn` and `ageingBucket` are
computed over the charges that remain open after applying credit FIFO on paper.
A client whose credit covers its two oldest charges must not be reported in
"90+" on the strength of debt its own money already answers. The existing
`dueOn <= asOf` filter is unchanged, so credit nets against charges that have
actually fallen due.

`getCurrentMonth` is deliberately left alone: it answers "has this client paid
for the period being billed", which is a question about a specific period's
charges, not about the client's overall position.

### 4.5 The client ledger already nets; only the credit figure is new

`getClientLedger`'s running balance already subtracts each payment in full,
regardless of how much of it was allocated, so a client paying in advance
already shows a negative balance there. The ledger response gains one field,
`availableCreditCents`, read from `payment_credits`, so the page can show what
is spendable and enable the Apply-credit action.

### 4.6 UI

- **Client ledger** (`ClientLedgerSection`): a credit figure with an
  Apply-credit action beside it, shown only when `availableCreditCents > 0`.
  The action opens the proposal, the operator confirms or redistributes, same
  as recording a payment.
- **Receivables** (`ReceivablesSection`): each row shows the net figure, with
  gross and credit beside it when `creditCents > 0`.
- **`Money`**: no signature change. Its `tone="credit"` escape hatch was
  designed for exactly this case (UI refresh spec, §"Still genuinely open"),
  because sign and meaning come apart here — credit is a positive number the
  client may spend.
- **i18n**: new keys in the `billing` namespace, pt-PT and en-GB both, covered
  by the existing `i18n:check` gate.

## 5. Data model

No table changes. One SQL-only migration creating `payment_credits` (§4.1).

Prisma does not model views, so the view is read through `$queryRaw` with an
explicit row type, exactly as `charge_balances` is read today.

## 6. Module layout

```
packages/domain/src/billing/
  types.ts        ProposedAllocation gains paymentId; AllocationSource added
  allocate.ts     proposeAllocation takes sources

apps/api/src/billing/
  billing.service.ts     getAvailableCredit, applyCredit; generateCharges and
                         getReceivables extended
  billing.controller.ts  POST clients/:clientId/apply-credit
  billing.cron.ts        unchanged call, new effect (credit applied in the same run)

apps/web/src/billing/
  ClientLedgerSection.tsx   credit figure + action
  ApplyCreditForm.tsx       propose/confirm, mirrors RecordPaymentForm
  ReceivablesSection.tsx    gross / credit / net
```

## 7. Testing

- `allocate.test.ts` — extended: several sources against one charge, one source
  spanning several charges, sources consumed oldest-first, a source with zero
  available skipped, empty sources. The existing property tests still hold and
  gain one: no proposal ever draws more from a source than that source has
  available.
- `billing.service` integration tests (Testcontainers): `payment_credits`
  reports zero for a fully allocated payment and the remainder for a partial
  one; `apply-credit` is idempotent (a second run with no new credit proposes
  nothing); generating charges applies credit to the charges it creates when
  they are already due, and separately sweeps a client's credit once an
  already-created charge falls due even when nothing new needs creating that
  run; the dry-run preview and the confirmed run agree on what would be
  spent, including when a newly generated charge is not yet due. Per the
  ruling in §4.3, there is no rollback-both test: charge creation and credit
  application are two transactions by design, and a failure spending credit
  must leave the already-committed charges in place.
- Receivables: a client whose credit exceeds its debt reports zero, never a
  negative; a client whose credit covers its oldest charges reports the ageing
  bucket of the charges that remain.
- E2E: record a payment larger than the open charges, confirm the client ledger
  shows the credit, apply it against a later charge, and confirm the
  receivables row and the home page total both fall.

## 8. Risks

No new risk beyond the master spec's §15. One note: `payment_credits` is
derived, so it cannot drift from the allocations — but any raw-SQL aggregate
written across it needs its own `::int` cast (ADR 0007), and forgetting it
fails at response serialization, not at migration time.

## 9. Open questions

1. Should credit that will never be spent (a client that has left) be
   cancellable with a reason, the way a charge is written off? Out of scope
   here; raise it if a real case appears.
2. Retainer amounts remain gross-only (master spec §16.1) — not re-opened by
   this design, noted as still live.
