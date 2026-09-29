-- `PaymentAllocation` had no timestamp of its own, so `periodSummary`'s
-- "settled" CTE proxied an allocation's existence-by-close through the
-- *payment*'s receivedOn. That proxy breaks once credit is applied after
-- the fact: `BillingService#applyCredit` writes an allocation row against
-- an *existing* payment, possibly months later, and that row's payment
-- still satisfies receivedOn <= a long-closed period's `to`. A closed
-- period would then answer differently depending on when it was asked —
-- exactly what this report exists to prevent. Give the allocation its own
-- timestamp so period reconstruction can key off it directly.

ALTER TABLE "PaymentAllocation" ADD COLUMN "createdAt" TIMESTAMPTZ(3);

-- Backfill from the payment's own receivedOn, not now(): every allocation
-- that predates this migration was written at payment-recording time (the
-- apply-credit flow that writes one later is what this migration exists
-- for), so receivedOn is exactly right for all of them, not an
-- approximation. Defaulting to the migration moment instead would mark
-- every historical allocation as made today, inflating every past period's
-- outstanding figure the moment this migration runs.
UPDATE "PaymentAllocation" a
SET "createdAt" = p."receivedOn"
FROM "Payment" p
WHERE p.id = a."paymentId";

ALTER TABLE "PaymentAllocation" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE "PaymentAllocation" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
