-- Round 2 of the periodSummary close-stability fix. The composite primary
-- key (paymentId, chargeId) forced one row per pair, so BillingService's
-- applyCredit had to upsert-increment a top-up into the existing row,
-- which meant the row's createdAt (fix round 1) could only ever speak for
-- the *first* tranche allocated to that pair. A charge issued in January,
-- partially covered by an allocation the same month, then topped up with
-- newly available credit in April, kept a January createdAt after the
-- top-up — so a January-to-March summary, re-run after April, would count
-- April's money as settled by 31 March. Neither leaving createdAt alone
-- nor bumping it to the top-up's date fixes this: one row cannot hold two
-- true timestamps for two tranches. So allocations become append-only —
-- a surrogate id replaces the composite key, and every application gets
-- its own row with its own true createdAt.

ALTER TABLE "PaymentAllocation" ADD COLUMN "id" UUID;
-- gen_random_uuid() is Postgres core since v13 — no extension needed.
UPDATE "PaymentAllocation" SET "id" = gen_random_uuid();
ALTER TABLE "PaymentAllocation" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE "PaymentAllocation" DROP CONSTRAINT "PaymentAllocation_pkey";
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id");

-- The composite key incidentally indexed paymentId (as its leading column)
-- and never usefully indexed chargeId. Every reader of this table
-- aggregates by one side or the other (charge_balances by chargeId,
-- payment_credits by paymentId, getClientLedger's groupBy by chargeId,
-- periodSummary's settled CTE by chargeId), so both need their own index
-- now that neither is backed by the old primary key.
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");
CREATE INDEX "PaymentAllocation_chargeId_idx" ON "PaymentAllocation"("chargeId");
