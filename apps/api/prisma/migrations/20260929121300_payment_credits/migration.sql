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
