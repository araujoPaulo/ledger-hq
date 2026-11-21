-- Optional user-chosen start for the obligation generator, later than or
-- equal to "startedAt". NULL means the generator starts at "startedAt".
ALTER TABLE "FiscalProfile" ADD COLUMN "obligationsFrom" DATE;

ALTER TABLE "FiscalProfile"
  ADD CONSTRAINT "fiscal_profile_obligations_from_after_started"
  CHECK ("obligationsFrom" IS NULL OR "obligationsFrom" >= "startedAt");
