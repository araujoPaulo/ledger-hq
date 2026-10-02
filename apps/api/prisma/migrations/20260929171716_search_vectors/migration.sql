-- DANGER: if you run `prisma migrate dev` (not `migrate deploy`) after this
-- migration and it offers to create a new one, DO NOT ACCEPT IT. Prisma's
-- schema-engine still introspects the physical catalog for the five
-- GENERATED ALWAYS AS (...) STORED columns below and their GIN indexes, even
-- though schema.prisma marks them Unsupported("tsvector"). If the
-- `@default(dbgenerated("..."))` text on those fields ever falls out of sync
-- with the actual expression Postgres reports back (via
-- `pg_get_expr(adbin, adrelid)` on pg_attrdef), `migrate dev` will propose a
-- migration that DROPs all five GIN indexes and then fails trying to
-- `ALTER COLUMN ... DROP DEFAULT` on a generated column (Postgres rejects
-- that; the correct verb is DROP EXPRESSION, which Prisma doesn't know to
-- use). Worse, that DROP INDEX half applies and commits before the failing
-- statement halts the script, silently degrading search to sequential scans
-- with no error anywhere. Verified live on 2026-09-29 in this worktree,
-- twice (it also stopped two earlier implementation attempts on this task).
-- The guard against this is the "search vector guard" describe block in
-- schema-constraints.integration.test.ts, which asserts the configuration
-- and all five GIN indexes exist by name on a freshly migrated database —
-- if this ever regresses, that test goes red instead of search going quiet.
-- Only ever apply migrations here with `prisma migrate deploy`.
--
-- `unaccent()` is not IMMUTABLE (it reads a dictionary file), so it cannot
-- appear in a generated column's expression. The supported way round is a
-- text-search configuration with `unaccent` mapped ahead of the Portuguese
-- stemmer, which IS immutable when named by a regconfig literal.
--
-- `unaccent` ships in postgres-contrib, which the postgres:18.6-alpine image
-- in docker-compose.yml already carries. Same one-time step btree_gist was
-- in Phase 0 and Phase 3: confirm the extension is available on the
-- production instance before this migration runs there.
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TEXT SEARCH CONFIGURATION portuguese_unaccent (COPY = portuguese);
ALTER TEXT SEARCH CONFIGURATION portuguese_unaccent
  ALTER MAPPING FOR hword, hword_part, word
  WITH unaccent, portuguese_stem;

-- Weights: A is what someone types when they mean to find THIS record, B is
-- a secondary handle, C is prose that should match but never outrank a name.
-- Generated, not trigger-maintained: Postgres recomputes the column on every
-- write of its inputs, so it cannot drift the way a trigger nobody updated
-- for a new column would.

ALTER TABLE "Client" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese_unaccent', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("taxId", '')), 'A') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("email", '')), 'B') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("phone", '')), 'B') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("socialSecurityNo", '')), 'B') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("notes", '')), 'C')
  ) STORED;

CREATE INDEX "Client_searchVector_idx" ON "Client" USING GIN ("searchVector");

ALTER TABLE "Platform" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese_unaccent', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("url", '')), 'B')
  ) STORED;

CREATE INDEX "Platform_searchVector_idx" ON "Platform" USING GIN ("searchVector");

-- The readable name lives on the definition and the period on the instance,
-- because a generated column can only reference its own row. The obligations
-- branch of the search query matches either vector across the join the two
-- tables already have.
ALTER TABLE "ObligationDefinition" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese_unaccent', coalesce("code", '')), 'A') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("legalRef", '')), 'B')
  ) STORED;

CREATE INDEX "ObligationDefinition_searchVector_idx" ON "ObligationDefinition" USING GIN ("searchVector");

ALTER TABLE "ObligationInstance" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese_unaccent', coalesce("periodLabel", '')), 'A') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("reference", '')), 'B') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("notes", '')), 'C')
  ) STORED;

CREATE INDEX "ObligationInstance_searchVector_idx" ON "ObligationInstance" USING GIN ("searchVector");

ALTER TABLE "Charge" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese_unaccent', coalesce("description", '')), 'A') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("periodLabel", '')), 'B') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce("writeOffReason", '')), 'C')
  ) STORED;

CREATE INDEX "Charge_searchVector_idx" ON "Charge" USING GIN ("searchVector");
