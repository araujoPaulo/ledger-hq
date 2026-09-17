-- CreateEnum
CREATE TYPE "Authority" AS ENUM ('TAX', 'SOCIAL_SECURITY', 'REGISTRY', 'OTHER');

-- CreateEnum
CREATE TYPE "Periodicity" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'ONE_OFF');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'WAIVED');

-- CreateEnum
CREATE TYPE "DefinitionSource" AS ENUM ('CATALOG', 'CUSTOM');

-- CreateTable
CREATE TABLE "ObligationDefinition" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "authority" "Authority" NOT NULL,
    "periodicity" "Periodicity" NOT NULL,
    "source" "DefinitionSource" NOT NULL,
    "legalRef" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ObligationDefinition_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ObligationInstance" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "definitionCode" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "dueDateOverridden" BOOLEAN NOT NULL DEFAULT false,
    "status" "ObligationStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMPTZ(3),
    "reference" TEXT,
    "amountCents" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ObligationInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ObligationInstance_clientId_idx" ON "ObligationInstance"("clientId");

-- CreateIndex
CREATE INDEX "ObligationInstance_status_dueDate_idx" ON "ObligationInstance"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ObligationInstance_clientId_definitionCode_periodStart_key" ON "ObligationInstance"("clientId", "definitionCode", "periodStart");

-- AddForeignKey
ALTER TABLE "ObligationInstance" ADD CONSTRAINT "ObligationInstance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObligationInstance" ADD CONSTRAINT "ObligationInstance_definitionCode_fkey" FOREIGN KEY ("definitionCode") REFERENCES "ObligationDefinition"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
