-- CreateEnum
CREATE TYPE "ChargeKind" AS ENUM ('RETAINER', 'EXTRA');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('TRANSFER', 'CASH', 'DIRECT_DEBIT', 'OTHER');

-- CreateTable
CREATE TABLE "RetainerPlan" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "periodicity" "Periodicity" NOT NULL,
    "dueDayOfMonth" INTEGER NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,

    CONSTRAINT "RetainerPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "kind" "ChargeKind" NOT NULL,
    "description" TEXT NOT NULL,
    "periodLabel" TEXT,
    "amountCents" INTEGER NOT NULL,
    "issuedOn" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "planId" UUID,
    "writtenOffAt" TIMESTAMPTZ(3),
    "writeOffReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "receivedOn" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "paymentId" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("paymentId","chargeId")
);

-- CreateIndex
CREATE INDEX "RetainerPlan_clientId_idx" ON "RetainerPlan"("clientId");

-- CreateIndex
CREATE INDEX "Charge_clientId_idx" ON "Charge"("clientId");

-- CreateIndex
CREATE INDEX "Charge_dueOn_idx" ON "Charge"("dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_clientId_planId_periodLabel_key" ON "Charge"("clientId", "planId", "periodLabel");

-- CreateIndex
CREATE INDEX "Payment_clientId_idx" ON "Payment"("clientId");

-- AddForeignKey
ALTER TABLE "RetainerPlan" ADD CONSTRAINT "RetainerPlan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_planId_fkey" FOREIGN KEY ("planId") REFERENCES "RetainerPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE CASCADE ON UPDATE CASCADE;


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
