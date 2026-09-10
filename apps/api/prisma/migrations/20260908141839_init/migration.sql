-- CreateEnum
CREATE TYPE "ClientKind" AS ENUM ('COMPANY', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "LegalForm" AS ENUM ('LDA', 'UNIPESSOAL_LDA', 'SA', 'ASSOCIATION', 'OTHER');

-- CreateEnum
CREATE TYPE "Accounting" AS ENUM ('ORGANIZED', 'SIMPLIFIED');

-- CreateEnum
CREATE TYPE "VatRegime" AS ENUM ('MONTHLY', 'QUARTERLY', 'EXEMPT', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "IncomeTax" AS ENUM ('CIT', 'PIT_CATEGORY_B', 'PIT_EMPLOYMENT_ONLY');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "kdfSalt" BYTEA NOT NULL,
    "authHashDigest" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'pt-PT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" UUID NOT NULL,
    "kind" "ClientKind" NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT NOT NULL,
    "accounting" "Accounting" NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "legalForm" "LegalForm",
    "socialSecurityNo" TEXT,
    "dateOfBirth" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalProfile" (
    "clientId" UUID NOT NULL,
    "hasOpenActivity" BOOLEAN NOT NULL,
    "vatRegime" "VatRegime" NOT NULL,
    "incomeTax" "IncomeTax" NOT NULL,
    "hasEmployees" BOOLEAN NOT NULL,
    "hasWithholding" BOOLEAN NOT NULL,
    "isVatCashBasis" BOOLEAN NOT NULL,
    "startedAt" DATE NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FiscalProfile_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "Employment" (
    "id" UUID NOT NULL,
    "employerId" UUID NOT NULL,
    "employerKind" "ClientKind" NOT NULL,
    "employeeId" UUID NOT NULL,
    "employeeKind" "ClientKind" NOT NULL,
    "startedOn" DATE NOT NULL,
    "endedOn" DATE,
    "jobTitle" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_taxId_key" ON "Client"("taxId");

-- CreateIndex
CREATE INDEX "Client_kind_name_idx" ON "Client"("kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Client_id_kind_key" ON "Client"("id", "kind");

-- CreateIndex
CREATE INDEX "Employment_employerId_idx" ON "Employment"("employerId");

-- CreateIndex
CREATE INDEX "Employment_employeeId_idx" ON "Employment"("employeeId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalProfile" ADD CONSTRAINT "FiscalProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_employerId_employerKind_fkey" FOREIGN KEY ("employerId", "employerKind") REFERENCES "Client"("id", "kind") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_employeeId_employeeKind_fkey" FOREIGN KEY ("employeeId", "employeeKind") REFERENCES "Client"("id", "kind") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Equality operators on uuid inside a GiST exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Discriminated columns: company fields only on companies, personal fields
-- only on individuals.
ALTER TABLE "Client" ADD CONSTRAINT "client_kind_fields" CHECK (
  (
    "kind" = 'COMPANY'::"ClientKind"
    AND "legalForm" IS NOT NULL
    AND "socialSecurityNo" IS NULL
    AND "dateOfBirth" IS NULL
  )
  OR
  ("kind" = 'INDIVIDUAL'::"ClientKind" AND "legalForm" IS NULL)
);

-- An employer is always a company and an employee always a natural person.
ALTER TABLE "Employment"
  ADD CONSTRAINT "employment_employer_is_company"
  CHECK ("employerKind" = 'COMPANY'::"ClientKind");

ALTER TABLE "Employment"
  ADD CONSTRAINT "employment_employee_is_individual"
  CHECK ("employeeKind" = 'INDIVIDUAL'::"ClientKind");

ALTER TABLE "Employment"
  ADD CONSTRAINT "employment_not_self"
  CHECK ("employerId" <> "employeeId");

ALTER TABLE "Employment"
  ADD CONSTRAINT "employment_ended_after_started"
  CHECK ("endedOn" IS NULL OR "endedOn" >= "startedOn");

-- No two overlapping spells for the same employer and employee pair.
ALTER TABLE "Employment" ADD CONSTRAINT "employment_no_overlap" EXCLUDE USING gist (
  "employerId" WITH =,
  "employeeId" WITH =,
  daterange("startedOn", "endedOn", '[]') WITH &&
);
