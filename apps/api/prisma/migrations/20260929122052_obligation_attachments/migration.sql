-- CreateTable
CREATE TABLE "ObligationAttachment" (
    "id" UUID NOT NULL,
    "obligationId" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObligationAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ObligationAttachment_obligationId_idx" ON "ObligationAttachment"("obligationId");

-- AddForeignKey
ALTER TABLE "ObligationAttachment" ADD CONSTRAINT "ObligationAttachment_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "ObligationInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
