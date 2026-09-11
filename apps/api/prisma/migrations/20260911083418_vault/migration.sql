-- CreateEnum
CREATE TYPE "AuthKind" AS ENUM ('PASSWORD', 'PASSWORD_OTP', 'CERTIFICATE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "vaultProtectedKey" BYTEA,
ADD COLUMN     "vaultRecoveryAuthDigest" TEXT,
ADD COLUMN     "vaultRecoveryKey" BYTEA,
ADD COLUMN     "vaultSetUpAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "Platform" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "authKind" "AuthKind" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Platform_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialVersion" (
    "id" UUID NOT NULL,
    "credentialId" UUID NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Platform_name_key" ON "Platform"("name");

-- CreateIndex
CREATE INDEX "Credential_clientId_idx" ON "Credential"("clientId");

-- CreateIndex
CREATE INDEX "Credential_updatedAt_idx" ON "Credential"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_clientId_platformId_label_key" ON "Credential"("clientId", "platformId", "label");

-- CreateIndex
CREATE INDEX "CredentialVersion_credentialId_createdAt_idx" ON "CredentialVersion"("credentialId", "createdAt");

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialVersion" ADD CONSTRAINT "CredentialVersion_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the small, shared platform catalog every practice starts with. Fixed
-- IDs so this statement is idempotent if the migration is ever re-run against
-- a database that already has them (it is not: migrations run exactly once,
-- but fixed IDs cost nothing and make the intent explicit).
INSERT INTO "Platform" ("id", "name", "url", "authKind", "createdAt", "updatedAt") VALUES
  ('00000000-0000-7000-8000-000000000001', 'Portal das Finanças', 'https://www.portaldasfinancas.gov.pt', 'PASSWORD', now(), now()),
  ('00000000-0000-7000-8000-000000000002', 'Segurança Social Direta', 'https://app.seg-social.pt', 'PASSWORD', now(), now()),
  ('00000000-0000-7000-8000-000000000003', 'ViaCTT', 'https://www.viactt.pt', 'PASSWORD_OTP', now(), now());
