-- CreateTable
CREATE TABLE "SystemHealth" (
    "id" UUID NOT NULL,
    "check" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemHealth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemHealth_check_occurredAt_idx" ON "SystemHealth"("check", "occurredAt");
