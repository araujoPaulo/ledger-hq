# Phase 4c — Obligation Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let submission receipts be attached to an obligation — uploaded, listed, downloaded and deleted — so proof of a filing lives in the system instead of a mail client or a scanner folder.

**Architecture:** The bytes live on a Docker volume in plaintext, mounted into the `api` service only; metadata rows live in Postgres. The path is a pure function of the row's own ids, so the user's filename never reaches the filesystem and the two stores cannot disagree about where a file is. A write goes file-then-row and a delete goes row-then-file, because an orphan file is invisible disk waste while an orphan row is a listed, clickable attachment that lies about evidence. Everything is served through the API behind `SessionGuard`; Caddy never sees the volume.

**Tech Stack:** TypeScript (ESM), NestJS 12, Prisma 7 + PostgreSQL 18, multer via `@nestjs/platform-express`, Zod, Vitest, Testcontainers, React 19 + TanStack Query, Workbox (`vite-plugin-pwa`), i18next, Playwright, Docker Compose, `age`.

**Spec:** `docs/superpowers/specs/2026-09-29-phase-4c-obligation-attachments-design.md`

## Global Constraints

- Node 24, pnpm 11, ESM everywhere. Relative imports inside `apps/api` carry the `.js` extension; imports from `@ledger-hq/domain` do not.
- ADR 0004 / master spec §10.3: the API never returns prose. New codes go in `packages/domain/src/errors.ts`, and the wire envelope is `{ error: { code, params } }` — integration tests assert on `response.body.error.code`, never `response.body.code`.
- **Every new `ErrorCode` must gain a message in both `apps/web/src/i18n/locales/pt/errors.json` and `en/errors.json` in the same commit that adds the code.** `apps/web/src/i18n/locales/locales.test.ts` iterates `ERROR_CODES` and fails the whole suite otherwise. This is not deferrable to the UI task.
- Every other new user-facing string needs a key in both locales; `pnpm --filter @ledger-hq/web i18n:check` fails on any key present in one and missing in the other.
- `validateEnv` (`apps/api/src/common/env-validation.ts`) runs at `ConfigModule.forRoot` time and refuses to boot without what it requires. Anything added there must also be set in `apps/api/test/global-setup.ts` and in `apps/web/playwright.config.ts`'s API `webServer` entry, or the integration and E2E suites stop starting at all.
- **The uploaded filename is data, never a path component.** It is stored in a column and emitted in `Content-Disposition`. It is never passed to `join()`, `resolve()` or any filesystem call.
- Uploads and downloads go through the API behind `SessionGuard`. The `web` container never mounts the attachments volume, and `docker/Caddyfile` gains no `file_server` for it.
- Nothing in `apps/web/src/ui/` learns what an attachment is (`docs/design/guidelines.md` §5). Domain vocabulary maps to a `BadgeTone` inside `obligations/`.
- After every task: `pnpm lint && pnpm typecheck && pnpm test` must pass before the commit.

## Review Focus

Five conditions the spec implies that no single feature test would otherwise reach. Each is pinned to a test in the task that owns the code.

1. **A hostile filename.** `../../etc/passwd`, a 300-character name, a name differing from another only by case or Unicode normalisation: none of it reaches the filesystem, because the path is built from two validated UUIDs and nothing else. (Task 4)
2. **A file lying about its type.** A PNG uploaded with `Content-Type: application/pdf` is rejected on its leading bytes — the client's declared type is a label, not evidence. (Task 5)
3. **One byte over the cap.** Multer aborts mid-stream with `MulterError('LIMIT_FILE_SIZE')`, which is not an `AppError` and would be flattened to `common.validation_failed` by the global filter; it must surface as `attachments.too_large` (413), and leave nothing on disk. (Task 8)
4. **A row whose file is gone**, which is exactly what restoring a dump and a file archive from different nights produces. The download answers `attachments.file_missing` (410) in the code-only envelope, never a 500 that reads like a bug. (Task 8)
5. **A downloaded receipt entering the PWA read cache.** The generic `NetworkFirst` rule for `GET /api/v1/*` would copy every receipt into Cache Storage, in plaintext, on every device that opens one, for 24 hours. The download route needs its own `NetworkOnly` rule ahead of it. (Task 9)

---

### Task 1: Error codes, constants, and their translations

**Files:**
- Modify: `packages/domain/src/errors.ts:38`
- Create: `packages/domain/src/schemas/attachments.ts`
- Create: `packages/domain/src/schemas/attachments.test.ts`
- Modify: `packages/domain/src/index.ts:15`
- Modify: `apps/web/src/i18n/locales/pt/errors.json`
- Modify: `apps/web/src/i18n/locales/en/errors.json`

**Interfaces:**
- Produces:
  ```ts
  // packages/domain/src/errors.ts — three new members of ERROR_CODES
  'attachments.type_not_allowed' | 'attachments.too_large' | 'attachments.file_missing'

  // packages/domain/src/schemas/attachments.ts
  export const ACCEPTED_ATTACHMENT_TYPES: readonly ['application/pdf', 'image/png', 'image/jpeg']
  export type AcceptedAttachmentType = (typeof ACCEPTED_ATTACHMENT_TYPES)[number]
  export const MAX_ATTACHMENT_BYTES: 10485760
  export const attachmentParamsSchema: z.ZodType<{ obligationId: string; id: string }>
  export type AttachmentParams = z.infer<typeof attachmentParamsSchema>
  export const obligationParamsSchema: z.ZodType<{ obligationId: string }>
  export type ObligationParams = z.infer<typeof obligationParamsSchema>
  ```
  Tasks 5, 8, 9 and 10 all consume these. The web app reads `ACCEPTED_ATTACHMENT_TYPES` for the file input's `accept` attribute and `MAX_ATTACHMENT_BYTES` to reject an oversized file before uploading it.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/schemas/attachments.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ERROR_CODES } from '../errors'
import {
  ACCEPTED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  attachmentParamsSchema,
  obligationParamsSchema,
} from './attachments'

describe('attachment constants', () => {
  it('accepts exactly the three types the design settled on', () => {
    expect([...ACCEPTED_ATTACHMENT_TYPES]).toEqual(['application/pdf', 'image/png', 'image/jpeg'])
  })

  it('caps an upload at 10 MiB', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024)
  })

  it('registers the three attachment error codes', () => {
    for (const code of ['attachments.type_not_allowed', 'attachments.too_large', 'attachments.file_missing']) {
      expect(ERROR_CODES).toContain(code)
    }
  })
})

describe('attachmentParamsSchema', () => {
  const obligationId = '0199f7b0-0000-7000-8000-000000000001'
  const id = '0199f7b0-0000-7000-8000-000000000002'

  it('accepts two uuids', () => {
    expect(attachmentParamsSchema.safeParse({ obligationId, id }).success).toBe(true)
  })

  // The path is built from these two values and nothing else (design §3.2),
  // so anything that is not a uuid must never reach the storage service.
  it.each(['..', '../../etc/passwd', '', 'not-a-uuid', `${id}/../..`])('rejects %j as an id', (bad) => {
    expect(attachmentParamsSchema.safeParse({ obligationId, id: bad }).success).toBe(false)
    expect(attachmentParamsSchema.safeParse({ obligationId: bad, id }).success).toBe(false)
  })

  it('rejects an unknown extra param', () => {
    expect(attachmentParamsSchema.safeParse({ obligationId, id, extra: 'x' }).success).toBe(false)
  })
})

describe('obligationParamsSchema', () => {
  it('accepts one uuid and rejects a path fragment', () => {
    expect(obligationParamsSchema.safeParse({ obligationId: '0199f7b0-0000-7000-8000-000000000001' }).success).toBe(true)
    expect(obligationParamsSchema.safeParse({ obligationId: '../..' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/domain test -- attachments
```

Expected: FAIL — `Cannot find module './attachments'`.

- [ ] **Step 3: Add the three codes**

In `packages/domain/src/errors.ts`, append to `ERROR_CODES`, after `'billing.charge_already_written_off'`:

```ts
  'attachments.type_not_allowed',
  'attachments.too_large',
  'attachments.file_missing',
```

- [ ] **Step 4: Write the schemas file**

Create `packages/domain/src/schemas/attachments.ts`:

```ts
import { z } from 'zod'
import { uuidSchema } from './common'

/**
 * A portal PDF, or a phone photo of a stamped counterfoil. Every extra type
 * is another format the download route can be talked into serving.
 */
export const ACCEPTED_ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const

export type AcceptedAttachmentType = (typeof ACCEPTED_ATTACHMENT_TYPES)[number]

/**
 * 10 MiB. A portal PDF is tens of kilobytes and a phone photo two to five
 * megabytes; this leaves headroom for a multi-page scan without letting a
 * mis-click park a video on the volume.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/**
 * The stored path is `<root>/<obligationId>/<id>` and nothing else (design
 * §3.2). Validating both halves as uuids at the edge is what makes that a
 * safe `join()` rather than a traversal waiting to happen — the storage
 * service asserts the same thing again, because defence that exists in one
 * place only is defence that moves when the code does.
 */
export const attachmentParamsSchema = z.object({ obligationId: uuidSchema, id: uuidSchema }).strict()

export type AttachmentParams = z.infer<typeof attachmentParamsSchema>

export const obligationParamsSchema = z.object({ obligationId: uuidSchema }).strict()

export type ObligationParams = z.infer<typeof obligationParamsSchema>
```

- [ ] **Step 5: Export it from the package index**

In `packages/domain/src/index.ts`, add after `export * from './schemas/billing'`:

```ts
export * from './schemas/attachments'
```

- [ ] **Step 6: Translate the three codes, both locales**

This is what keeps `locales.test.ts` green. In `apps/web/src/i18n/locales/pt/errors.json`, add a block after `billing`:

```json
  "attachments": {
    "type_not_allowed": "Só são aceites ficheiros PDF, PNG ou JPEG.",
    "too_large": "O ficheiro excede o limite de 10 MB.",
    "file_missing": "O ficheiro deste anexo não está no servidor. O registo foi mantido para saberes o que era preciso voltar a obter."
  }
```

and in `apps/web/src/i18n/locales/en/errors.json`, the same block:

```json
  "attachments": {
    "type_not_allowed": "Only PDF, PNG and JPEG files are accepted.",
    "too_large": "The file is over the 10 MB limit.",
    "file_missing": "This attachment's file is not on the server. The record was kept so you know what needs fetching again."
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/domain test -- attachments
pnpm --filter @ledger-hq/web test -- locales
pnpm --filter @ledger-hq/web i18n:check
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS everywhere. `locales.test.ts` proves the three codes are translated; `i18n:check` proves the two bundles still agree.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src apps/web/src/i18n/locales
git commit -m "feat(domain): add attachment error codes, limits and param schemas

The two route-param schemas exist so the ids that build a storage path
are validated as uuids at the edge, which is what makes joining them
safe rather than a traversal.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The `ObligationAttachment` table

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (the `ObligationInstance` model, plus a new model after it)
- Create: `apps/api/prisma/migrations/<timestamp>_obligation_attachments/migration.sql` (generated)
- Test: `apps/api/test/schema-constraints.integration.test.ts`

**Interfaces:**
- Produces: the `ObligationAttachment` Prisma model, and `ObligationInstance.attachments`. Tasks 7 and 8 write and read these rows.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/schema-constraints.integration.test.ts`. That file already has `const prisma = getTestPrisma()` and a `createCompany(taxId)` helper at the top; reuse both rather than adding your own.

```ts
describe('ObligationAttachment', () => {
  async function anObligation(taxId: string): Promise<string> {
    const clientId = await createCompany(taxId)
    // `source` is required and has no default (schema.prisma's
    // DefinitionSource enum): CUSTOM, because this definition is a fixture,
    // not a row the catalog sync owns.
    await prisma.obligationDefinition.upsert({
      where: { code: 'TEST_ATTACHMENTS' },
      update: {},
      create: {
        code: 'TEST_ATTACHMENTS',
        name: 'Test obligation',
        authority: 'TAX',
        periodicity: 'MONTHLY',
        source: 'CUSTOM',
      },
    })
    const obligation = await prisma.obligationInstance.create({
      data: {
        id: uuidv7(),
        clientId,
        definitionCode: 'TEST_ATTACHMENTS',
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-01-31T00:00:00Z'),
        periodLabel: '2026-01',
        dueDate: new Date('2026-02-20T00:00:00Z'),
      },
    })
    return obligation.id
  }

  it('stores the uploaded filename as data, not as a path', async () => {
    const obligationId = await anObligation('508111111')
    const id = uuidv7()

    await prisma.obligationAttachment.create({
      data: {
        id,
        obligationId,
        // Deliberately hostile: this is allowed in the column precisely
        // because it never reaches the filesystem (design §3.2).
        filename: '../../etc/passwd',
        contentType: 'application/pdf',
        sizeBytes: 1234,
        sha256: 'a'.repeat(64),
      },
    })

    const stored = await prisma.obligationAttachment.findUniqueOrThrow({ where: { id } })
    expect(stored.filename).toBe('../../etc/passwd')
    expect(stored.uploadedAt).toBeInstanceOf(Date)
  })

  it('cascades when the obligation is deleted', async () => {
    const obligationId = await anObligation('508222222')
    await prisma.obligationAttachment.create({
      data: { id: uuidv7(), obligationId, filename: 'receipt.pdf', contentType: 'application/pdf', sizeBytes: 10, sha256: 'b'.repeat(64) },
    })

    await prisma.obligationInstance.delete({ where: { id: obligationId } })

    expect(await prisma.obligationAttachment.count({ where: { obligationId } })).toBe(0)
  })

  it('refuses an attachment on an obligation that does not exist', async () => {
    await expect(
      prisma.obligationAttachment.create({
        data: { id: uuidv7(), obligationId: uuidv7(), filename: 'x.pdf', contentType: 'application/pdf', sizeBytes: 1, sha256: 'c'.repeat(64) },
      }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/api test:integration -- schema-constraints
```

Expected: FAIL — `prisma.obligationAttachment` is undefined.

- [ ] **Step 3: Add the model**

In `apps/api/prisma/schema.prisma`, add one line to `ObligationInstance`'s relation block, beside `client` and `definition`:

```prisma
  attachments ObligationAttachment[]
```

and add the model after `ObligationInstance`:

```prisma
model ObligationAttachment {
  id           String   @id @db.Uuid
  obligationId String   @db.Uuid
  // The name the operator's browser sent. Data only: it is emitted in
  // Content-Disposition and never joined into a path (design §3.2).
  filename     String
  contentType  String
  sizeBytes    Int
  sha256       String
  uploadedAt   DateTime @default(now()) @db.Timestamptz(3)

  obligation ObligationInstance @relation(fields: [obligationId], references: [id], onDelete: Cascade)

  @@index([obligationId])
}
```

There is deliberately **no `storagePath` column**: the path is `join(root, obligationId, id)`, a pure function of this row, so file and row cannot drift.

- [ ] **Step 4: Generate and apply the migration**

```bash
cd apps/api
set -a && . ./.env && set +a
pnpm exec prisma migrate dev --name obligation_attachments
cd ../..
```

Read the generated `migration.sql` before moving on: it must be a `CREATE TABLE` plus an index and a foreign key with `ON DELETE CASCADE`, and must not touch any existing table's data.

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @ledger-hq/api test:integration -- schema-constraints
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(api): add the ObligationAttachment table

No storagePath column: the path is a pure function of the row's own
ids, so the filesystem and the database cannot disagree about where a
file is.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `ATTACHMENTS_DIR`, everywhere it has to be set

**Files:**
- Modify: `apps/api/src/common/env-validation.ts`
- Modify: `apps/api/src/common/env-validation.test.ts`
- Modify: `apps/api/test/global-setup.ts`
- Modify: `apps/web/playwright.config.ts:16-21`
- Modify: `docker-compose.yml:44-46` and its `volumes:` block
- Modify: `.env.example`
- Modify: `apps/api/.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `validateEnv` refuses to boot without a non-empty `ATTACHMENTS_DIR`; every harness that boots the app sets one. Task 4 reads it through `ConfigService`.

This task changes nothing user-visible and must land before the module that needs it, because `validateEnv` failing is a boot failure, not a request failure — it breaks every existing suite the moment it lands half-done.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/common/env-validation.test.ts`, matching its existing cases:

```ts
describe('ATTACHMENTS_DIR', () => {
  it('refuses to start without one', () => {
    expect(() => validateEnv({ AUTH_SALT_SECRET: 'secret' })).toThrow(/ATTACHMENTS_DIR/)
  })

  it('refuses an empty one', () => {
    expect(() => validateEnv({ AUTH_SALT_SECRET: 'secret', ATTACHMENTS_DIR: '' })).toThrow(/ATTACHMENTS_DIR/)
  })

  it('accepts a path', () => {
    expect(validateEnv({ AUTH_SALT_SECRET: 'secret', ATTACHMENTS_DIR: '/var/lib/ledger-hq/attachments' })).toMatchObject({
      ATTACHMENTS_DIR: '/var/lib/ledger-hq/attachments',
    })
  })
})
```

Every existing case in that file passes only `AUTH_SALT_SECRET`, so they will now fail too — that is the point, and Step 4 fixes them.

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/api test -- env-validation
```

Expected: FAIL — the new cases do not throw.

- [ ] **Step 3: Require it**

In `apps/api/src/common/env-validation.ts`, extend the function, keeping the existing doc comment and adding to it:

```ts
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const secret = config.AUTH_SALT_SECRET

  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('AUTH_SALT_SECRET must be set to a non-empty string')
  }

  // Same reasoning as above, one layer out: a missing attachments directory
  // fails lazily, on the first upload, in production, months after the
  // deploy that forgot it. Failing at ConfigModule.forRoot time means the
  // process refuses to start at all.
  const attachmentsDir = config.ATTACHMENTS_DIR

  if (typeof attachmentsDir !== 'string' || attachmentsDir.length === 0) {
    throw new Error('ATTACHMENTS_DIR must be set to a non-empty path')
  }

  return config
}
```

- [ ] **Step 4: Fix the existing cases in that test file**

One existing case expects success: `'passes a config with AUTH_SALT_SECRET set through unchanged'`. Give it the new variable, so it still asserts pass-through rather than the new throw:

```ts
  it('passes a config with AUTH_SALT_SECRET set through unchanged', () => {
    const config = { AUTH_SALT_SECRET: 'a-real-secret', ATTACHMENTS_DIR: '/tmp/ledger-hq-attachments', OTHER_VAR: '1' }

    expect(validateEnv(config)).toEqual(config)
  })
```

The three cases asserting a throw on a missing, empty or non-string `AUTH_SALT_SECRET` keep their shape unchanged — they throw for their own reason, first.

- [ ] **Step 5: Set it in the integration harness**

In `apps/api/test/global-setup.ts`, add below the `AUTH_SALT_SECRET` line, inside `setup()`:

```ts
  // Same reason as AUTH_SALT_SECRET above: ConfigModule's `validate` runs
  // the instant app.module.ts is imported, before any test file's setup.
  process.env.ATTACHMENTS_DIR ??= await mkdtemp(join(tmpdir(), 'ledger-hq-attachments-'))
```

with the imports at the top of the file:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
```

`teardown()` leaves the directory behind deliberately: it is under the OS temp directory, it is a few kilobytes of test fixtures, and deleting a path built from an environment variable in a teardown is a worse failure mode than leaking one.

- [ ] **Step 6: Set it for the E2E API server**

In `apps/web/playwright.config.ts`, the first `webServer` entry runs the real API, which now refuses to boot without the variable. Give it one:

```ts
    {
      command: 'pnpm --filter @ledger-hq/api start',
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // The API refuses to boot without this (env-validation.ts). Without
      // it here, every spec in the suite fails on a dead web server, not
      // on anything they actually assert.
      env: { ATTACHMENTS_DIR: join(tmpdir(), 'ledger-hq-e2e-attachments') },
    },
```

with `import { tmpdir } from 'node:os'` and `import { join } from 'node:path'` at the top. Playwright's `env` is merged over the inherited environment, so `DATABASE_URL` exported in the shell still reaches the API.

- [ ] **Step 7: Wire the volume into Compose**

In `docker-compose.yml`, add to the `api` service's `environment:` block:

```yaml
      ATTACHMENTS_DIR: /var/lib/ledger-hq/attachments
```

add a `volumes:` block to that same service:

```yaml
    volumes:
      # Mounted into `api` only. The web container serves the public bundle
      # with no authentication (docker/Caddyfile); a receipt is not public,
      # so every byte leaves through a route behind SessionGuard instead.
      - attachments-data:/var/lib/ledger-hq/attachments
```

and extend the top-level `volumes:` block:

```yaml
volumes:
  postgres-data:
  attachments-data:
```

- [ ] **Step 8: Document it in both env examples**

In `.env.example`, after `AUTH_SALT_SECRET`:

```
# Where obligation attachments are stored inside the api container. The
# Compose file mounts the attachments-data volume here; change both together.
ATTACHMENTS_DIR=/var/lib/ledger-hq/attachments
```

In `apps/api/.env.example`, after `AUTH_SALT_SECRET`:

```
# Local development: any writable path outside the repo, or the gitignored
# .attachments/ directory in the checkout.
ATTACHMENTS_DIR=./.attachments
```

and add to `.gitignore`, after the `coverage/` line:

```
apps/api/.attachments/
```

- [ ] **Step 9: Run everything that boots the app**

```bash
pnpm --filter @ledger-hq/api test -- env-validation
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @ledger-hq/api test:integration
docker compose config >/dev/null
```

Expected: PASS, and `docker compose config` prints no error — it is the cheapest proof the YAML is valid and the volume resolves.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/common apps/api/test/global-setup.ts apps/web/playwright.config.ts docker-compose.yml .env.example apps/api/.env.example .gitignore
git commit -m "feat(api): require ATTACHMENTS_DIR at boot, and mount the volume

A missing attachments directory would otherwise fail on the first
upload, in production, months after the deploy that forgot it. Set in
both test harnesses too, since validateEnv failing is a boot failure
that would take every suite down with it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `FileStorageService` — the path, and the atomic write

**Files:**
- Create: `apps/api/src/attachments/file-storage.service.ts`
- Create: `apps/api/src/attachments/file-storage.service.test.ts`

**Interfaces:**
- Consumes: `ATTACHMENTS_DIR` via `ConfigService` (Task 3).
- Produces:
  ```ts
  @Injectable()
  export class FileStorageService {
    constructor(config: ConfigService)
    pathFor(obligationId: string, attachmentId: string): string
    write(obligationId: string, attachmentId: string, bytes: Buffer): Promise<void>
    read(obligationId: string, attachmentId: string): Promise<Buffer>   // throws ENOENT
    exists(obligationId: string, attachmentId: string): Promise<boolean>
    remove(obligationId: string, attachmentId: string): Promise<void>   // idempotent
  }
  ```
  Task 7 orchestrates these against the database.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/attachments/file-storage.service.test.ts`:

```ts
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConfigService } from '@nestjs/config'
import { FileStorageService } from './file-storage.service.js'

const OBLIGATION = '0199f7b0-0000-7000-8000-000000000001'
const ATTACHMENT = '0199f7b0-0000-7000-8000-000000000002'

let root: string
let storage: FileStorageService

function configWith(dir: string): ConfigService {
  return { getOrThrow: () => dir } as unknown as ConfigService
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ledger-hq-storage-'))
  storage = new FileStorageService(configWith(root))
})

describe('pathFor', () => {
  it('builds the path from the two ids and nothing else', () => {
    expect(storage.pathFor(OBLIGATION, ATTACHMENT)).toBe(join(root, OBLIGATION, ATTACHMENT))
  })

  // The controller validates both ids as uuids (Task 1), so this can only
  // fire if someone later calls the service from somewhere that does not.
  // It is the last line of defence, so it is a real one.
  it.each(['..', '../..', `..${sep}..${sep}etc${sep}passwd`, 'a/b', '', 'x\0y'])(
    'refuses %j rather than escaping the root',
    (bad) => {
      expect(() => storage.pathFor(OBLIGATION, bad)).toThrow(/attachment id/i)
      expect(() => storage.pathFor(bad, ATTACHMENT)).toThrow(/obligation id/i)
    },
  )
})

describe('write', () => {
  it('writes the bytes and leaves no temporary file behind', async () => {
    await storage.write(OBLIGATION, ATTACHMENT, Buffer.from('%PDF-1.7 receipt'))

    expect(await readFile(storage.pathFor(OBLIGATION, ATTACHMENT))).toEqual(Buffer.from('%PDF-1.7 receipt'))
    expect(await readdir(join(root, OBLIGATION))).toEqual([ATTACHMENT])
  })

  it('creates the obligation directory on first write', async () => {
    await storage.write(OBLIGATION, ATTACHMENT, Buffer.from('x'))

    expect(await readdir(root)).toContain(OBLIGATION)
  })

  it('replaces an existing file rather than appending to it', async () => {
    await storage.write(OBLIGATION, ATTACHMENT, Buffer.from('first'))
    await storage.write(OBLIGATION, ATTACHMENT, Buffer.from('second'))

    expect(await readFile(storage.pathFor(OBLIGATION, ATTACHMENT), 'utf8')).toBe('second')
  })
})

describe('read', () => {
  it('returns the exact bytes that were written', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00])
    await storage.write(OBLIGATION, ATTACHMENT, bytes)

    expect(await storage.read(OBLIGATION, ATTACHMENT)).toEqual(bytes)
  })

  it('raises rather than returning empty when the file is gone', async () => {
    await expect(storage.read(OBLIGATION, ATTACHMENT)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('exists', () => {
  it('is false before a write and true after it', async () => {
    expect(await storage.exists(OBLIGATION, ATTACHMENT)).toBe(false)
    await storage.write(OBLIGATION, ATTACHMENT, Buffer.from('x'))
    expect(await storage.exists(OBLIGATION, ATTACHMENT)).toBe(true)
  })
})

describe('remove', () => {
  it('deletes the file', async () => {
    await storage.write(OBLIGATION, ATTACHMENT, Buffer.from('x'))

    await storage.remove(OBLIGATION, ATTACHMENT)

    expect(await storage.exists(OBLIGATION, ATTACHMENT)).toBe(false)
  })

  // A delete runs row-first (design §3.3), so by the time this is called the
  // row is already gone. Throwing here would fail a request that has, from
  // the operator's point of view, already succeeded.
  it('is a no-op when the file is already gone', async () => {
    await expect(storage.remove(OBLIGATION, ATTACHMENT)).resolves.toBeUndefined()
  })
})

describe('a pre-existing stray temporary file', () => {
  it('does not become visible as an attachment', async () => {
    await storage.write(OBLIGATION, ATTACHMENT, Buffer.from('real'))
    await writeFile(`${storage.pathFor(OBLIGATION, ATTACHMENT)}.tmp`, 'half-written')

    // Readers address a file by its id; the .tmp suffix is not an id, so a
    // crash mid-write can never be served as an attachment.
    expect(await readFile(storage.pathFor(OBLIGATION, ATTACHMENT), 'utf8')).toBe('real')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/api test -- file-storage
```

Expected: FAIL — `Cannot find module './file-storage.service.js'`.

- [ ] **Step 3: Implement it**

Create `apps/api/src/attachments/file-storage.service.ts`:

```ts
import { mkdirSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Injectable } from '@nestjs/common'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ConfigService } from '@nestjs/config'

/** Lowercase hex uuid with dashes — the shape `uuidv7()` produces. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The attachment bytes, and only the bytes. It knows nothing about rows,
 * obligations or content types.
 *
 * Every path it produces is `<root>/<obligationId>/<attachmentId>`, built
 * from two values it has itself checked are uuids. The filename the operator
 * uploaded is never involved: it is an arbitrary string that can traverse
 * (`../../etc/passwd`), collide under case-insensitive or
 * Unicode-normalising filesystems, or exceed `NAME_MAX` (design §3.2).
 */
@Injectable()
export class FileStorageService {
  private readonly root: string

  constructor(config: ConfigService) {
    this.root = config.getOrThrow<string>('ATTACHMENTS_DIR')
    // Synchronous, in the constructor, on purpose: a directory that cannot
    // be created is a misconfigured deployment, and the process should
    // refuse to come up rather than accept an upload it cannot store.
    mkdirSync(this.root, { recursive: true })
  }

  pathFor(obligationId: string, attachmentId: string): string {
    if (!UUID.test(obligationId)) throw new Error(`obligation id is not a uuid: ${JSON.stringify(obligationId)}`)
    if (!UUID.test(attachmentId)) throw new Error(`attachment id is not a uuid: ${JSON.stringify(attachmentId)}`)

    return join(this.root, obligationId, attachmentId)
  }

  /**
   * Atomic against a crash mid-stream: the bytes land on `<path>.tmp` and are
   * renamed into place, so a half-written file is never visible under the
   * real name. `rename` within one directory is atomic on every filesystem
   * this runs on.
   */
  async write(obligationId: string, attachmentId: string, bytes: Buffer): Promise<void> {
    const path = this.pathFor(obligationId, attachmentId)
    await mkdir(join(this.root, obligationId), { recursive: true })

    const temporary = `${path}.tmp`
    await writeFile(temporary, bytes)
    await rename(temporary, path)
  }

  async read(obligationId: string, attachmentId: string): Promise<Buffer> {
    return readFile(this.pathFor(obligationId, attachmentId))
  }

  async exists(obligationId: string, attachmentId: string): Promise<boolean> {
    try {
      await stat(this.pathFor(obligationId, attachmentId))
      return true
    } catch {
      return false
    }
  }

  /** Idempotent: the row is deleted first, so the file may already be gone. */
  async remove(obligationId: string, attachmentId: string): Promise<void> {
    await rm(this.pathFor(obligationId, attachmentId), { force: true })
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/api test -- file-storage
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/attachments
git commit -m "feat(api): store attachment bytes under a path derived from ids

The uploaded filename never reaches the filesystem: it traverses,
collides under case folding and Unicode normalisation, and can exceed
NAME_MAX. The path is two validated uuids. Writes go through a .tmp
rename so a crash mid-stream is never visible under the real name.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Sniff the bytes; do not believe the label

**Files:**
- Create: `apps/api/src/attachments/attachments.service.ts` (pure functions only in this task)
- Create: `apps/api/src/attachments/attachments.service.test.ts`

**Interfaces:**
- Consumes: `ACCEPTED_ATTACHMENT_TYPES`, `MAX_ATTACHMENT_BYTES` (Task 1).
- Produces:
  ```ts
  export function sniffContentType(bytes: Buffer): AcceptedAttachmentType | null
  export function assertAcceptable(declaredType: string, bytes: Buffer): AcceptedAttachmentType  // throws AppError
  ```
  Task 7's `AttachmentsService.upload` calls `assertAcceptable`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/attachments/attachments.service.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { AppError } from '@ledger-hq/domain'
import { assertAcceptable, sniffContentType } from './attachments.service.js'

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])

describe('sniffContentType', () => {
  it.each([
    ['application/pdf', PDF],
    ['image/png', PNG],
    ['image/jpeg', JPEG],
  ])('recognises %s from its leading bytes', (expected, bytes) => {
    expect(sniffContentType(bytes)).toBe(expected)
  })

  it.each([
    ['a zip, which PDFs are often confused with', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
    ['an ELF binary', Buffer.from([0x7f, 0x45, 0x4c, 0x46])],
    ['plain text', Buffer.from('hello, this is not a receipt')],
    ['an empty buffer', Buffer.alloc(0)],
    ['a buffer shorter than any signature', Buffer.from([0x25, 0x50])],
  ])('returns null for %s', (_label, bytes) => {
    expect(sniffContentType(bytes)).toBeNull()
  })
})

describe('assertAcceptable', () => {
  it('returns the sniffed type when the declaration agrees', () => {
    expect(assertAcceptable('application/pdf', PDF)).toBe('application/pdf')
  })

  it('tolerates a charset parameter on the declared type', () => {
    expect(assertAcceptable('application/pdf; charset=binary', PDF)).toBe('application/pdf')
  })

  // The multipart part's Content-Type is chosen by the client. It is a
  // label, not evidence (design §3.4).
  it('rejects a PNG declared as a PDF', () => {
    expect(() => assertAcceptable('application/pdf', PNG)).toThrow(AppError)
    try {
      assertAcceptable('application/pdf', PNG)
    } catch (error) {
      expect((error as AppError).code).toBe('attachments.type_not_allowed')
      expect((error as AppError).status).toBe(415)
    }
  })

  it('rejects a file whose bytes match nothing accepted, however it is labelled', () => {
    try {
      assertAcceptable('application/pdf', Buffer.from('#!/bin/sh\nrm -rf /'))
    } catch (error) {
      expect((error as AppError).code).toBe('attachments.type_not_allowed')
    }
  })

  it('rejects an accepted-looking file declared as an unaccepted type', () => {
    try {
      assertAcceptable('application/zip', PDF)
    } catch (error) {
      expect((error as AppError).code).toBe('attachments.type_not_allowed')
      expect((error as AppError).params).toMatchObject({ contentType: 'application/zip' })
    }
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/api test -- attachments.service
```

Expected: FAIL — `Cannot find module './attachments.service.js'`.

- [ ] **Step 3: Implement the two functions**

Create `apps/api/src/attachments/attachments.service.ts` with the pure half only; Task 7 adds the class below it.

```ts
import { AppError } from '@ledger-hq/domain'
import { ACCEPTED_ATTACHMENT_TYPES } from '@ledger-hq/domain'
import type { AcceptedAttachmentType } from '@ledger-hq/domain'

/**
 * Leading bytes, in the order they are checked. Long signatures first so a
 * shorter prefix can never shadow a longer one.
 */
const SIGNATURES: Array<{ type: AcceptedAttachmentType; magic: readonly number[] }> = [
  { type: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { type: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
]

export function sniffContentType(bytes: Buffer): AcceptedAttachmentType | null {
  for (const { type, magic } of SIGNATURES) {
    if (bytes.length < magic.length) continue
    if (magic.every((byte, index) => bytes[index] === byte)) return type
  }

  return null
}

/**
 * A multipart part's declared `Content-Type` is chosen by the client and is
 * not evidence (design §3.4). The bytes decide, and the declaration has to
 * agree with them — a mismatch is rejected exactly as an unaccepted type is,
 * because both mean the same thing: this is not the file it claims to be.
 */
export function assertAcceptable(declaredType: string, bytes: Buffer): AcceptedAttachmentType {
  // `image/jpeg; charset=binary` is a legitimate thing for a browser to send.
  const declared = declaredType.split(';')[0]?.trim().toLowerCase() ?? ''
  const sniffed = sniffContentType(bytes)

  if (sniffed === null || declared !== sniffed || !(ACCEPTED_ATTACHMENT_TYPES as readonly string[]).includes(declared)) {
    throw new AppError('attachments.type_not_allowed', { contentType: declaredType }, 415)
  }

  return sniffed
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/api test -- attachments.service
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/attachments
git commit -m "feat(api): accept an attachment on its bytes, not on its label

The multipart part's Content-Type is chosen by the client. Sniffing the
leading bytes and requiring the declaration to agree is what makes the
accepted-types list mean anything.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `Content-Disposition` for a filename that fights back

**Files:**
- Create: `apps/api/src/attachments/content-disposition.ts`
- Create: `apps/api/src/attachments/content-disposition.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function contentDisposition(filename: string): string
  ```
  Always `attachment`, never `inline` (design §3.8). Task 8's download route sets the header from it.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/attachments/content-disposition.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { contentDisposition } from './content-disposition.js'

describe('contentDisposition', () => {
  it('is always an attachment, never inline', () => {
    // Inline would hand a hostile PDF to the browser's own renderer in an
    // origin holding an unlocked vault session (design §3.8).
    expect(contentDisposition('receipt.pdf')).toMatch(/^attachment;/)
  })

  it('carries a plain ASCII name as-is', () => {
    expect(contentDisposition('receipt.pdf')).toBe(`attachment; filename="receipt.pdf"; filename*=UTF-8''receipt.pdf`)
  })

  it('keeps a non-ASCII name intact in filename* and folds it for the fallback', () => {
    const header = contentDisposition('Declaração periódica — 2026Q1.pdf')

    expect(header).toContain(`filename*=UTF-8''Declara%C3%A7%C3%A3o%20peri%C3%B3dica%20%E2%80%94%202026Q1.pdf`)
    // The fallback must be ASCII-only: a raw non-ASCII byte in a header
    // value is what makes a client drop the header entirely.
    const fallback = /filename="([^"]*)"/.exec(header)?.[1] ?? ''
    expect(fallback).toBe('Declaracao periodica  2026Q1.pdf')
    // eslint-disable-next-line no-control-regex -- asserting the absence of control and high bytes is the point
    expect(fallback).not.toMatch(/[^\x20-\x7e]/)
  })

  it('strips a quote, a backslash and a newline rather than emitting them', () => {
    // A bare " ends the quoted string early and a CR/LF splits the response
    // into two — header injection, from a filename the operator typed.
    const header = contentDisposition('a"b\\c\r\nd.pdf')

    expect(header).not.toContain('\r')
    expect(header).not.toContain('\n')
    const fallback = /filename="([^"]*)"/.exec(header)?.[1] ?? ''
    expect(fallback).toBe('abcd.pdf')
  })

  it('never emits an empty fallback, however little survives folding', () => {
    const fallback = /filename="([^"]*)"/.exec(contentDisposition('日本語.pdf'))?.[1] ?? ''

    expect(fallback).toBe('attachment')
  })

  it('percent-encodes a quote and a space in filename* too', () => {
    expect(contentDisposition('a b".pdf')).toContain(`filename*=UTF-8''a%20b%22.pdf`)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/api test -- content-disposition
```

Expected: FAIL — `Cannot find module './content-disposition.js'`.

- [ ] **Step 3: Implement it**

Create `apps/api/src/attachments/content-disposition.ts`:

```ts
/**
 * Builds an RFC 6266 / RFC 5987 `Content-Disposition` for a filename the
 * operator chose, which is to say an arbitrary string.
 *
 * Two names go out: `filename*` carries the real one, UTF-8 and
 * percent-encoded, which every current browser prefers; `filename` is the
 * ASCII fallback for anything that does not understand `filename*`. The
 * fallback is folded rather than escaped, because a raw control character or
 * a bare quote in a header value is header injection, not a filename.
 */
export function contentDisposition(filename: string): string {
  const fallback = asciiFallback(filename)

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(filename)}`
}

function asciiFallback(filename: string): string {
  const folded = filename
    // Decompose, then drop the combining marks: "ç" becomes "c" rather than
    // being deleted outright, which keeps a Portuguese filename readable.
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    // Everything outside printable ASCII goes, and so do the two characters
    // that would end the quoted string or split the response.
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '')
    .trim()

  return folded === '' ? 'attachment' : folded
}

function encodeRfc5987(value: string): string {
  // encodeURIComponent leaves !'()* alone; RFC 5987's attr-char excludes
  // them, so they are encoded by hand.
  return encodeURIComponent(value).replace(/['()!*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/api test -- content-disposition
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS. If the em-dash assertion fails, check that the fixture in the test uses U+2014 and not a hyphen — `Declaração periódica — 2026Q1.pdf` percent-encodes it as `%E2%80%94`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/attachments
git commit -m "feat(api): build Content-Disposition from a hostile filename safely

filename* carries the real name; the ASCII fallback is folded, not
escaped, because a bare quote or a CRLF in a header value is injection
rather than a filename.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `AttachmentsService` — file first, row second

**Files:**
- Modify: `apps/api/src/attachments/attachments.service.ts` (add the class below the pure functions)
- Modify: `apps/api/src/attachments/attachments.service.test.ts`
- Modify: `apps/api/src/obligations/obligations.module.ts:11` (add `exports`)

**Interfaces:**
- Consumes: `FileStorageService` (Task 4), `assertAcceptable` (Task 5), `ObligationsService.findOne` (existing, but see Step 3), `PrismaService`.
- Produces:
  ```ts
  export type AttachmentResponse = {
    id: string; obligationId: string; filename: string
    contentType: string; sizeBytes: number; uploadedAt: string
  }

  @Injectable()
  export class AttachmentsService {
    constructor(prisma: PrismaService, storage: FileStorageService, obligations: ObligationsService)
    upload(obligationId: string, file: { originalname: string; mimetype: string; buffer: Buffer }): Promise<AttachmentResponse>
    list(obligationId: string): Promise<AttachmentResponse[]>
    download(obligationId: string, id: string): Promise<{ bytes: Buffer; filename: string; contentType: string }>
    remove(obligationId: string, id: string): Promise<void>
  }
  ```
  Task 8's controller calls exactly these four.

- [ ] **Step 1: Export `ObligationsService` from its module**

`AttachmentsModule` (Task 8) imports `ObligationsModule` to resolve the parent obligation, but `ObligationsModule` currently declares no `exports`, so importing it provides nothing. Add the line, matching `ClientsModule`:

```ts
  exports: [ObligationsService],
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/api/src/attachments/attachments.service.test.ts`. These are unit tests with fakes, because the ordering guarantee is about *what happens when one half fails* — which a real database cannot be asked for on demand.

```ts
import { AttachmentsService } from './attachments.service.js'
import type { FileStorageService } from './file-storage.service.js'
import type { PrismaService } from '../common/prisma.service.js'
import type { ObligationsService } from '../obligations/obligations.service.js'

const OBLIGATION = '0199f7b0-0000-7000-8000-000000000001'

function fakes(overrides: { createFails?: boolean; writeFails?: boolean; fileMissing?: boolean } = {}) {
  const written: string[] = []
  const rows: Array<Record<string, unknown>> = []

  const storage = {
    async write(obligationId: string, attachmentId: string) {
      if (overrides.writeFails) throw new Error('ENOSPC: no space left on device')
      written.push(`${obligationId}/${attachmentId}`)
    },
    async read() {
      return Buffer.from('%PDF-1.7')
    },
    async exists() {
      return overrides.fileMissing !== true
    },
    async remove(obligationId: string, attachmentId: string) {
      const index = written.indexOf(`${obligationId}/${attachmentId}`)
      if (index >= 0) written.splice(index, 1)
    },
  } as unknown as FileStorageService

  const prisma = {
    obligationAttachment: {
      async create({ data }: { data: Record<string, unknown> }) {
        if (overrides.createFails) throw new Error('duplicate key value violates unique constraint')
        rows.push({ ...data, uploadedAt: new Date('2026-03-01T10:00:00Z') })
        return rows.at(-1)
      },
      // The where clauses are honoured, not ignored: two of the tests below
      // are precisely about an id being scoped to its obligation.
      async findMany({ where }: { where: { obligationId: string } }) {
        return rows.filter((row) => row.obligationId === where.obligationId)
      },
      async findFirst({ where }: { where: { id: string; obligationId: string } }) {
        return rows.find((row) => row.id === where.id && row.obligationId === where.obligationId) ?? null
      },
      async delete({ where }: { where: { id: string } }) {
        const index = rows.findIndex((row) => row.id === where.id)
        return rows.splice(index, 1)[0]
      },
    },
  } as unknown as PrismaService

  const obligations = { async findOne() {} } as unknown as ObligationsService

  return { service: new AttachmentsService(prisma, storage, obligations), written, rows }
}

const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const file = { originalname: 'Declaração.pdf', mimetype: 'application/pdf', buffer: PDF_BYTES }

describe('upload ordering', () => {
  it('writes the file, then the row', async () => {
    const { service, written, rows } = fakes()

    const response = await service.upload(OBLIGATION, file)

    expect(written).toHaveLength(1)
    expect(rows).toHaveLength(1)
    expect(response).toMatchObject({
      obligationId: OBLIGATION,
      filename: 'Declaração.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF_BYTES.length,
    })
    expect(response.uploadedAt).toBe('2026-03-01T10:00:00.000Z')
  })

  it('records the sha256 of the bytes, not of the name', async () => {
    const { service, rows } = fakes()

    await service.upload(OBLIGATION, file)

    // sha256 of the eight bytes of "%PDF-1.7".
    expect(rows[0]?.sha256).toBe(createHash('sha256').update(PDF_BYTES).digest('hex'))
  })

  // This is the ordering decision itself (design §3.3): an orphan file is
  // invisible disk waste, reclaimed by the sweep; an orphan row would be a
  // listed, clickable attachment that fails when clicked.
  it('leaves an orphan file, and no row, when the row write fails', async () => {
    const { service, written, rows } = fakes({ createFails: true })

    await expect(service.upload(OBLIGATION, file)).rejects.toThrow(/duplicate key/)

    expect(written).toHaveLength(1)
    expect(rows).toHaveLength(0)
  })

  it('writes no row at all when the file write fails', async () => {
    const { service, rows } = fakes({ writeFails: true })

    await expect(service.upload(OBLIGATION, file)).rejects.toThrow(/ENOSPC/)

    expect(rows).toHaveLength(0)
  })

  it('rejects a file whose bytes are not an accepted type before touching either store', async () => {
    const { service, written, rows } = fakes()

    await expect(
      service.upload(OBLIGATION, { originalname: 'x.pdf', mimetype: 'application/pdf', buffer: Buffer.from('not a pdf') }),
    ).rejects.toMatchObject({ code: 'attachments.type_not_allowed' })

    expect(written).toHaveLength(0)
    expect(rows).toHaveLength(0)
  })
})

describe('download', () => {
  it('returns the bytes, the stored name and the sniffed type', async () => {
    const { service } = fakes()
    const uploaded = await service.upload(OBLIGATION, file)

    const downloaded = await service.download(OBLIGATION, uploaded.id)

    expect(downloaded.filename).toBe('Declaração.pdf')
    expect(downloaded.contentType).toBe('application/pdf')
    expect(downloaded.bytes).toEqual(Buffer.from('%PDF-1.7'))
  })

  // Exactly what restoring a dump and a file archive from different nights
  // produces (design §4.3): the row survived, the file did not.
  it('answers attachments.file_missing when the row outlived its file', async () => {
    const { service } = fakes({ fileMissing: true })
    const uploaded = await service.upload(OBLIGATION, file)

    await expect(service.download(OBLIGATION, uploaded.id)).rejects.toMatchObject({
      code: 'attachments.file_missing',
      status: 410,
    })
  })

  it('answers common.not_found for an id belonging to another obligation', async () => {
    const { service } = fakes()
    await service.upload(OBLIGATION, file)

    await expect(service.download('0199f7b0-0000-7000-8000-0000000000ff', '0199f7b0-0000-7000-8000-0000000000fe')).rejects.toMatchObject({
      code: 'common.not_found',
      status: 404,
    })
  })
})

describe('remove ordering', () => {
  it('deletes the row before the file', async () => {
    const { service, written, rows } = fakes()
    await service.upload(OBLIGATION, file)
    const uploaded = (await service.list(OBLIGATION))[0]!

    await service.remove(OBLIGATION, uploaded.id)

    expect(rows).toHaveLength(0)
    expect(written).toHaveLength(0)
  })
})
```

Add `import { createHash } from 'node:crypto'` to the top of the file.

- [ ] **Step 3: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/api test -- attachments.service
```

Expected: FAIL — `AttachmentsService is not a constructor`.

- [ ] **Step 4: Implement the class**

Append to `apps/api/src/attachments/attachments.service.ts`. That file already imports `AppError` and `ACCEPTED_ATTACHMENT_TYPES` from `@ledger-hq/domain` (Task 5) — merge the import block below into the existing one rather than adding a second import of the same module, which ESLint's `no-duplicate-imports` will reject:

```ts
import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { uuidv7 } from 'uuidv7'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ObligationsService } from '../obligations/obligations.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { FileStorageService } from './file-storage.service.js'
import type { ObligationAttachment } from '../generated/prisma/client.js'

export type AttachmentResponse = {
  id: string
  obligationId: string
  filename: string
  contentType: string
  sizeBytes: number
  uploadedAt: string
}

/** `sha256` stays off the wire: it exists for restore reconciliation (design §4.3). */
function toResponse(row: ObligationAttachment): AttachmentResponse {
  return {
    id: row.id,
    obligationId: row.obligationId,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.uploadedAt.toISOString(),
  }
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
    private readonly obligations: ObligationsService,
  ) {}

  /**
   * File first, row second (design §3.3). There is no transaction spanning
   * two systems, so the order is chosen by which failure is survivable: a
   * file with no row is invisible to every reader and reclaimed by the
   * sweep; a row with no file is a listed, clickable attachment that fails
   * when clicked, which is a lie about evidence.
   */
  async upload(
    obligationId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ): Promise<AttachmentResponse> {
    // Throws common.not_found for an obligation that does not exist, before
    // anything is written anywhere.
    await this.obligations.findOne(obligationId)

    const contentType = assertAcceptable(file.mimetype, file.buffer)
    const id = uuidv7()

    await this.storage.write(obligationId, id, file.buffer)

    const row = await this.prisma.obligationAttachment.create({
      data: {
        id,
        obligationId,
        filename: file.originalname,
        contentType,
        sizeBytes: file.buffer.length,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
      },
    })

    return toResponse(row)
  }

  async list(obligationId: string): Promise<AttachmentResponse[]> {
    const rows = await this.prisma.obligationAttachment.findMany({
      where: { obligationId },
      orderBy: { uploadedAt: 'asc' },
    })

    return rows.map(toResponse)
  }

  async download(obligationId: string, id: string): Promise<{ bytes: Buffer; filename: string; contentType: string }> {
    const row = await this.findRow(obligationId, id)

    if (!(await this.storage.exists(obligationId, id))) {
      // A row that outlived its file — a restore across mismatched archives,
      // or a failed upload's row that never existed. Say so in a code the
      // UI can translate, rather than a 500 that reads like a bug.
      throw new AppError('attachments.file_missing', { attachmentId: id }, 410)
    }

    return { bytes: await this.storage.read(obligationId, id), filename: row.filename, contentType: row.contentType }
  }

  /** Row first, file second — the mirror of `upload`, for the same reason. */
  async remove(obligationId: string, id: string): Promise<void> {
    await this.findRow(obligationId, id)

    await this.prisma.obligationAttachment.delete({ where: { id } })
    await this.storage.remove(obligationId, id)
  }

  /**
   * Scoped to the obligation in the URL, not looked up by id alone: without
   * the scope, an id from one obligation would resolve under another
   * obligation's path and read a file that is not there — or, worse, be
   * deleted through a URL that does not name it.
   */
  private async findRow(obligationId: string, id: string): Promise<ObligationAttachment> {
    const row = await this.prisma.obligationAttachment.findFirst({ where: { id, obligationId } })
    if (!row) throw new AppError('common.not_found', {}, 404)

    return row
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/api test -- attachments.service
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/attachments apps/api/src/obligations/obligations.module.ts
git commit -m "feat(api): orchestrate attachment rows and files, file first

An orphan file is invisible disk waste the sweep reclaims; an orphan
row is a listed attachment that fails when clicked. The order follows
from which of those is survivable. Delete runs the reverse.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The four routes, and the multer error that would have been swallowed

**Files:**
- Create: `apps/api/src/attachments/attachments.controller.ts`
- Create: `apps/api/src/attachments/multer-error.filter.ts`
- Create: `apps/api/src/attachments/multer-error.filter.test.ts`
- Create: `apps/api/src/attachments/attachments.module.ts`
- Modify: `apps/api/src/app.module.ts:17,32`
- Modify: `apps/api/package.json` (dependencies)
- Test: `apps/api/test/attachments.integration.test.ts` (create)

**Interfaces:**
- Consumes: `AttachmentsService` (Task 7), `contentDisposition` (Task 6), `attachmentParamsSchema` / `obligationParamsSchema` / `MAX_ATTACHMENT_BYTES` (Task 1).
- Produces: the four routes of design §3.5. Task 9's web client calls them.

- [ ] **Step 1: Add the dependencies**

```bash
pnpm --filter @ledger-hq/api add multer
pnpm --filter @ledger-hq/api add -D @types/multer
```

`@nestjs/platform-express` already provides `FileInterceptor`; `multer` is what it wraps, and `@types/multer` is what types `Express.Multer.File`.

- [ ] **Step 2: Write the failing filter test**

Create `apps/api/src/attachments/multer-error.filter.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { ArgumentsHost } from '@nestjs/common'
import { MulterError } from 'multer'
import { MulterErrorFilter } from './multer-error.filter.js'

function hostSpy() {
  const json = vi.fn()
  const status = vi.fn().mockReturnValue({ json })
  const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as unknown as ArgumentsHost

  return { host, status, json }
}

describe('MulterErrorFilter', () => {
  // Without this filter the global AppErrorFilter sees a plain
  // HttpException-less Error and renders common.internal_error at 500 — a
  // file one byte over the cap would read as a server bug.
  it('maps LIMIT_FILE_SIZE to attachments.too_large at 413', () => {
    const { host, status, json } = hostSpy()

    new MulterErrorFilter().catch(new MulterError('LIMIT_FILE_SIZE', 'file'), host)

    expect(status).toHaveBeenCalledWith(413)
    expect(json).toHaveBeenCalledWith({ error: { code: 'attachments.too_large', params: { maxBytes: 10 * 1024 * 1024 } } })
  })

  it('maps every other multer failure to common.validation_failed at 422', () => {
    const { host, status, json } = hostSpy()

    new MulterErrorFilter().catch(new MulterError('LIMIT_UNEXPECTED_FILE', 'nope'), host)

    expect(status).toHaveBeenCalledWith(422)
    expect(json).toHaveBeenCalledWith({ error: { code: 'common.validation_failed', params: {} } })
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/api test -- multer-error
```

Expected: FAIL — `Cannot find module './multer-error.filter.js'`.

- [ ] **Step 4: Write the filter**

Create `apps/api/src/attachments/multer-error.filter.ts`:

```ts
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { Catch } from '@nestjs/common'
import type { Response } from 'express'
import { MulterError } from 'multer'
import { MAX_ATTACHMENT_BYTES } from '@ledger-hq/domain'

/**
 * Multer enforces the size cap while the body is still streaming and signals
 * it by throwing a `MulterError`, which is neither an `AppError` nor an
 * `HttpException`. The global `AppErrorFilter` would therefore render it as
 * `common.internal_error` at 500 — a file one byte over the limit reading as
 * a server fault.
 *
 * Controller-scoped filters run before global ones, so this catches the
 * error first and keeps the code-only envelope (ADR 0004) intact.
 */
@Catch(MulterError)
export class MulterErrorFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()

    if (exception.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({ error: { code: 'attachments.too_large', params: { maxBytes: MAX_ATTACHMENT_BYTES } } })
      return
    }

    response.status(422).json({ error: { code: 'common.validation_failed', params: {} } })
  }
}
```

- [ ] **Step 5: Write the failing integration tests**

Create `apps/api/test/attachments.integration.test.ts`, following `apps/api/test/obligations.integration.test.ts`'s harness idiom:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from 'uuidv7'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app.js'
import { getTestPrisma, resetDatabase } from './database.js'
import { authenticate } from './authenticate.js'

const prisma = getTestPrisma()

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])

let app: INestApplication
let cookie: string[]

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

async function anObligation(taxId: string): Promise<string> {
  const client = await prisma.client.create({
    data: { id: uuidv7(), kind: 'COMPANY', name: 'Anexos, Lda.', taxId, accounting: 'ORGANIZED', legalForm: 'LDA' },
  })
  await prisma.obligationDefinition.upsert({
    where: { code: 'TEST_ATTACHMENTS' },
    update: {},
    create: { code: 'TEST_ATTACHMENTS', name: 'Test obligation', authority: 'TAX', periodicity: 'MONTHLY', source: 'CUSTOM' },
  })
  const obligation = await prisma.obligationInstance.create({
    data: {
      id: uuidv7(),
      clientId: client.id,
      definitionCode: 'TEST_ATTACHMENTS',
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-01-31T00:00:00Z'),
      periodLabel: '2026-01',
      dueDate: new Date('2026-02-20T00:00:00Z'),
    },
  })
  return obligation.id
}

function upload(obligationId: string, bytes: Buffer, filename: string, contentType: string) {
  return request(app.getHttpServer())
    .post(`/api/v1/obligations/${obligationId}/attachments`)
    .set('Cookie', cookie)
    .set('X-Requested-With', 'ledger-hq')
    .attach('file', bytes, { filename, contentType })
}

describe('attachment upload, list, download and delete', () => {
  it('round-trips the exact bytes', async () => {
    const obligationId = await anObligation('509111111')

    const created = await upload(obligationId, PDF, 'recibo.pdf', 'application/pdf').expect(201)
    expect(created.body).toMatchObject({
      obligationId,
      filename: 'recibo.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF.length,
    })
    expect(created.body.sha256).toBeUndefined()

    const listed = await request(app.getHttpServer())
      .get(`/api/v1/obligations/${obligationId}/attachments`)
      .set('Cookie', cookie)
      .expect(200)
    expect(listed.body).toHaveLength(1)

    const downloaded = await request(app.getHttpServer())
      .get(`/api/v1/obligations/${obligationId}/attachments/${created.body.id}`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => callback(null, Buffer.concat(chunks)))
      })
      .expect(200)

    expect(downloaded.body).toEqual(PDF)
    expect(downloaded.headers['content-type']).toContain('application/pdf')
    expect(downloaded.headers['content-disposition']).toBe(
      `attachment; filename="recibo.pdf"; filename*=UTF-8''recibo.pdf`,
    )

    await request(app.getHttpServer())
      .delete(`/api/v1/obligations/${obligationId}/attachments/${created.body.id}`)
      .set('Cookie', cookie)
      .set('X-Requested-With', 'ledger-hq')
      .expect(204)

    const afterDelete = await request(app.getHttpServer())
      .get(`/api/v1/obligations/${obligationId}/attachments`)
      .set('Cookie', cookie)
      .expect(200)
    expect(afterDelete.body).toEqual([])
  })

  it('keeps a non-ASCII filename intact in the header', async () => {
    const obligationId = await anObligation('509222222')
    const created = await upload(obligationId, PDF, 'Declaração periódica.pdf', 'application/pdf').expect(201)

    const downloaded = await request(app.getHttpServer())
      .get(`/api/v1/obligations/${obligationId}/attachments/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(200)

    expect(downloaded.headers['content-disposition']).toContain(
      `filename*=UTF-8''Declara%C3%A7%C3%A3o%20peri%C3%B3dica.pdf`,
    )
    expect(downloaded.headers['content-disposition']).toContain('filename="Declaracao periodica.pdf"')
  })

  it('rejects a PNG declared as a PDF', async () => {
    const obligationId = await anObligation('509333333')

    const response = await upload(obligationId, PNG, 'fake.pdf', 'application/pdf').expect(415)

    expect(response.body.error.code).toBe('attachments.type_not_allowed')
    expect(await prisma.obligationAttachment.count()).toBe(0)
  })

  it('answers 410 attachments.file_missing when the row outlived its file', async () => {
    const obligationId = await anObligation('509444444')
    const created = await upload(obligationId, PDF, 'recibo.pdf', 'application/pdf').expect(201)

    // Exactly what a dump and a file archive from different nights produce.
    await rm(join(process.env.ATTACHMENTS_DIR!, obligationId, String(created.body.id)), { force: true })

    const response = await request(app.getHttpServer())
      .get(`/api/v1/obligations/${obligationId}/attachments/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(410)

    expect(response.body.error.code).toBe('attachments.file_missing')
  })

  it('cascades the rows when the obligation is deleted', async () => {
    const obligationId = await anObligation('509555555')
    await upload(obligationId, PDF, 'recibo.pdf', 'application/pdf').expect(201)

    await prisma.obligationInstance.delete({ where: { id: obligationId } })

    expect(await prisma.obligationAttachment.count()).toBe(0)
  })

  it('refuses an upload for an obligation that does not exist', async () => {
    const response = await upload(uuidv7(), PDF, 'recibo.pdf', 'application/pdf').expect(404)

    expect(response.body.error.code).toBe('common.not_found')
  })

  it('refuses an id that is not a uuid, before it can reach a path', async () => {
    const obligationId = await anObligation('509666666')

    const response = await request(app.getHttpServer())
      .get(`/api/v1/obligations/${obligationId}/attachments/..`)
      .set('Cookie', cookie)

    expect([404, 422]).toContain(response.status)
    expect(response.body.error.code).not.toBe('common.internal_error')
  })

  it('rejects an upload with no X-Requested-With header', async () => {
    const obligationId = await anObligation('509777777')

    const response = await request(app.getHttpServer())
      .post(`/api/v1/obligations/${obligationId}/attachments`)
      .set('Cookie', cookie)
      .attach('file', PDF, { filename: 'recibo.pdf', contentType: 'application/pdf' })
      .expect(403)

    expect(response.body.error.code).toBe('common.forbidden')
  })

  it('rejects every route without a session', async () => {
    const obligationId = await anObligation('509888888')

    const response = await request(app.getHttpServer()).get(`/api/v1/obligations/${obligationId}/attachments`).expect(401)

    expect(response.body).toEqual({ error: { code: 'auth.session_expired', params: {} } })
  })
})
```

Add `import { rm } from 'node:fs/promises'` and `import { join } from 'node:path'` at the top. `SessionGuard` throws `auth.session_expired` at 401 for a missing cookie (`apps/api/src/auth/session.guard.ts`), which is what the last assertion pins.

- [ ] **Step 6: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/api test:integration -- attachments
```

Expected: FAIL — every request 404s; the routes do not exist.

- [ ] **Step 7: Write the controller**

Create `apps/api/src/attachments/attachments.controller.ts`:

```ts
import { Controller, Delete, Get, HttpCode, Param, Post, Res, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import type { Response } from 'express'
import { MAX_ATTACHMENT_BYTES, attachmentParamsSchema, obligationParamsSchema } from '@ledger-hq/domain'
import type { AttachmentParams, ObligationParams } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
import { contentDisposition } from './content-disposition.js'
import { MulterErrorFilter } from './multer-error.filter.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { AttachmentsService } from './attachments.service.js'
import type { AttachmentResponse } from './attachments.service.js'

@Controller('obligations/:obligationId/attachments')
@UseGuards(SessionGuard)
@UseFilters(MulterErrorFilter)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // In memory, not on disk: 10 MiB is small, and holding the bytes lets
      // the service sniff and hash them before anything is written.
      storage: memoryStorage(),
      // Multer aborts the stream here; MulterErrorFilter turns that into
      // attachments.too_large rather than a 500.
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
    }),
  )
  async upload(
    @Param(new ZodValidationPipe(obligationParamsSchema)) params: ObligationParams,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<AttachmentResponse> {
    return this.attachments.upload(params.obligationId, file)
  }

  @Get()
  async list(
    @Param(new ZodValidationPipe(obligationParamsSchema)) params: ObligationParams,
  ): Promise<AttachmentResponse[]> {
    return this.attachments.list(params.obligationId)
  }

  @Get(':id')
  async download(
    @Param(new ZodValidationPipe(attachmentParamsSchema)) params: AttachmentParams,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.attachments.download(params.obligationId, params.id)

    // Always `attachment`, never `inline`: the page never renders the bytes
    // (design §3.8). `X-Content-Type-Options: nosniff` already rides on
    // every response via helmet() in main.ts, and this route depends on it.
    response
      .status(200)
      .setHeader('Content-Type', file.contentType)
      .setHeader('Content-Disposition', contentDisposition(file.filename))
      .setHeader('Content-Length', String(file.bytes.length))
      .end(file.bytes)
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param(new ZodValidationPipe(attachmentParamsSchema)) params: AttachmentParams): Promise<void> {
    await this.attachments.remove(params.obligationId, params.id)
  }
}
```

- [ ] **Step 8: Wire the module in**

Create `apps/api/src/attachments/attachments.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ObligationsModule } from '../obligations/obligations.module.js'
import { PrismaService } from '../common/prisma.service.js'
import { AttachmentsController } from './attachments.controller.js'
import { AttachmentsService } from './attachments.service.js'
import { FileStorageService } from './file-storage.service.js'

@Module({
  imports: [AuthModule, ObligationsModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, FileStorageService, PrismaService],
})
export class AttachmentsModule {}
```

and register it in `apps/api/src/app.module.ts`: add the import beside the others,

```ts
import { AttachmentsModule } from './attachments/attachments.module.js'
```

and the entry in `imports`, after `ObligationsModule`:

```ts
    AttachmentsModule,
```

- [ ] **Step 9: Run everything**

```bash
pnpm --filter @ledger-hq/api test -- multer-error
pnpm --filter @ledger-hq/api test:integration -- attachments
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS. If the route ordering makes `GET /obligations/:obligationId/attachments` collide with the obligations controller's own `@Get('obligations')`, it will not — that one has no path segment after `obligations` — but if a 404 appears on the list route, check that `AttachmentsModule` is registered after `ObligationsModule` in `app.module.ts`.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src apps/api/test/attachments.integration.test.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): upload, list, download and delete obligation attachments

Every byte leaves through a route behind SessionGuard; Caddy never sees
the volume. Downloads are always attachment-disposition, never inline.
A controller-scoped filter maps multer's LIMIT_FILE_SIZE to
attachments.too_large, which the global filter would otherwise have
rendered as a 500.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The web client, and keeping receipts out of the read cache

**Files:**
- Create: `apps/web/src/api/upload.ts`
- Create: `apps/web/src/api/upload.test.ts`
- Create: `apps/web/src/obligations/attachmentsApi.ts`
- Modify: `apps/web/vite.config.ts:47-56`

**Interfaces:**
- Consumes: the four routes (Task 8), `ACCEPTED_ATTACHMENT_TYPES`/`MAX_ATTACHMENT_BYTES` (Task 1).
- Produces:
  ```ts
  // apps/web/src/api/upload.ts
  export function apiUpload<T>(path: string, file: File, field?: string): Promise<T>

  // apps/web/src/obligations/attachmentsApi.ts
  export type Attachment = { id: string; obligationId: string; filename: string; contentType: string; sizeBytes: number; uploadedAt: string }
  export function listAttachments(obligationId: string): Promise<Attachment[]>
  export function uploadAttachment(obligationId: string, file: File): Promise<Attachment>
  export function deleteAttachment(obligationId: string, id: string): Promise<void>
  export function attachmentDownloadUrl(obligationId: string, id: string): string
  ```
  Task 10's panel calls these.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/api/upload.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
import { apiUpload } from './upload'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(response: Partial<Response> & { json: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'recibo.pdf', { type: 'application/pdf' })

describe('apiUpload', () => {
  it('sends the CSRF header', async () => {
    const fetchMock = stubFetch({ ok: true, status: 201, json: async () => ({ id: 'a1' }) })

    await apiUpload('/obligations/o1/attachments', file)

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers['X-Requested-With']).toBe('ledger-hq')
  })

  // The browser has to set multipart/form-data itself, because only it knows
  // the boundary. apiFetch hardcodes application/json, which is exactly why
  // this helper exists instead of a flag on that one.
  it('sets no Content-Type of its own', async () => {
    const fetchMock = stubFetch({ ok: true, status: 201, json: async () => ({}) })

    await apiUpload('/obligations/o1/attachments', file)

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain('content-type')
  })

  it('sends the file as multipart under the "file" field', async () => {
    const fetchMock = stubFetch({ ok: true, status: 201, json: async () => ({}) })

    await apiUpload('/obligations/o1/attachments', file)

    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('file')).toBe(file)
  })

  it('throws the server code, not a generic failure', async () => {
    stubFetch({
      ok: false,
      status: 415,
      json: async () => ({ error: { code: 'attachments.type_not_allowed', params: { contentType: 'application/zip' } } }),
    })

    await expect(apiUpload('/obligations/o1/attachments', file)).rejects.toMatchObject({
      code: 'attachments.type_not_allowed',
      status: 415,
    })
  })

  it('reports a dead network as common.offline, like apiFetch does', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(apiUpload('/obligations/o1/attachments', file)).rejects.toBeInstanceOf(ApiError)
    await expect(apiUpload('/obligations/o1/attachments', file)).rejects.toMatchObject({ code: 'common.offline' })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- upload
```

Expected: FAIL — `Cannot find module './upload'`.

- [ ] **Step 3: Write the upload helper**

Create `apps/web/src/api/upload.ts`:

```ts
import { ApiError } from './client'
import type { ClientErrorCode } from './client'

const BASE_PATH = '/api/v1'

/**
 * A multipart POST, beside `apiFetch` rather than inside it.
 *
 * `apiFetch` always sets `Content-Type: application/json`. A multipart body
 * must not carry that header at all: only the browser knows the boundary it
 * generated, and overriding it produces a body the server cannot parse. The
 * CSRF header still has to go out, because `CsrfGuard` rejects every
 * mutation without it.
 */
export async function apiUpload<T>(path: string, file: File, field = 'file'): Promise<T> {
  const body = new FormData()
  body.append(field, file)

  let response: Response

  try {
    response = await fetch(`${BASE_PATH}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'ledger-hq' },
      body,
    })
  } catch {
    throw new ApiError('common.offline', {}, 0)
  }

  const payload: unknown = await response.json().catch(() => ({}))

  if (!response.ok) {
    const envelope = (payload as { error?: { code?: string; params?: Record<string, unknown> } }).error

    throw new ApiError(
      (envelope?.code as ClientErrorCode | undefined) ?? 'common.unexpected',
      envelope?.params ?? {},
      response.status,
    )
  }

  return payload as T
}
```

- [ ] **Step 4: Write the attachments API module**

Create `apps/web/src/obligations/attachmentsApi.ts`:

```ts
import { apiFetch } from '../api/client'
import { apiUpload } from '../api/upload'

export type Attachment = {
  id: string
  obligationId: string
  filename: string
  contentType: string
  sizeBytes: number
  /** ISO-8601. */
  uploadedAt: string
}

export function listAttachments(obligationId: string): Promise<Attachment[]> {
  return apiFetch<Attachment[]>(`/obligations/${obligationId}/attachments`)
}

export function uploadAttachment(obligationId: string, file: File): Promise<Attachment> {
  return apiUpload<Attachment>(`/obligations/${obligationId}/attachments`, file)
}

export function deleteAttachment(obligationId: string, id: string): Promise<void> {
  return apiFetch<void>(`/obligations/${obligationId}/attachments/${id}`, { method: 'DELETE' })
}

/**
 * A plain URL, not a fetch: the download is an `<a download>`, so the
 * browser streams it straight to disk and the bytes never enter the page's
 * memory — or, more to the point, the service worker's cache (see the
 * NetworkOnly rule in vite.config.ts).
 */
export function attachmentDownloadUrl(obligationId: string, id: string): string {
  return `/api/v1/obligations/${obligationId}/attachments/${id}`
}
```

`deleteAttachment` returns 204 with an empty body; `apiFetch` calls `response.json().catch(() => ({}))`, so an empty body resolves to `{}` rather than throwing.

- [ ] **Step 5: Keep downloads out of the read cache**

In `apps/web/vite.config.ts`, add a second `NetworkOnly` rule **immediately after** the `vault-envelope` one and **before** the generic `NetworkFirst` block:

```ts
          {
            // A downloaded receipt must never land in `api-reads`. That
            // cache holds plaintext in Cache Storage for 24 hours on every
            // device that opens one — the gap docs/security-model.md
            // already names for the client register; there is no reason to
            // widen it to document images. Same ordering rule as above:
            // Workbox matches in array order, first match wins, so this
            // must stay ahead of the generic NetworkFirst rule.
            //
            // The *list* route deliberately stays on NetworkFirst:
            // filenames and sizes are metadata of the kind already cached.
            urlPattern: ({ url, request }) =>
              /^\/api\/v1\/obligations\/[^/]+\/attachments\/[^/]+$/.test(url.pathname) && request.method === 'GET',
            handler: 'NetworkOnly' as const,
          },
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/web test -- upload
pnpm --filter @ledger-hq/web build
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS, and the build emits a service worker. Confirm the new rule is in it:

```bash
grep -c 'attachments' apps/web/dist/sw.js
```

Expected: at least `1`. A `0` means the rule did not survive into the generated worker, and the cache gap is still open.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api apps/web/src/obligations/attachmentsApi.ts apps/web/vite.config.ts
git commit -m "feat(web): upload attachments, and keep downloads out of the cache

apiFetch hardcodes a JSON Content-Type, which multipart must not carry,
so uploads get their own narrow helper that still sends the CSRF
header. The download route gets a NetworkOnly rule ahead of the generic
NetworkFirst one, so receipts never sit in plaintext Cache Storage.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: The panel, the badge, and the words

**Files:**
- Create: `apps/web/src/obligations/ObligationAttachments.tsx`
- Create: `apps/web/src/obligations/ObligationAttachments.test.tsx`
- Modify: `apps/web/src/obligations/ObligationRow.tsx:6-12,28-42`
- Modify: `apps/web/src/obligations/ObligationsSection.tsx:15,95-101`
- Modify: `apps/web/src/obligations/ObligationsSection.test.tsx`
- Modify: `apps/web/src/i18n/locales/pt/obligations.json`
- Modify: `apps/web/src/i18n/locales/en/obligations.json`

**Interfaces:**
- Consumes: `listAttachments`, `uploadAttachment`, `deleteAttachment`, `attachmentDownloadUrl` (Task 9).
- Produces:
  ```tsx
  export function ObligationAttachments(props: { obligation: ObligationResponse; onClose: () => void }): JSX.Element
  // ObligationRow gains two optional props, supplied only by ObligationsSection:
  //   onManageAttachments?: () => void
  //   attachmentCount?: number
  ```

- [ ] **Step 1: Add the i18n keys, both locales**

In `apps/web/src/i18n/locales/pt/obligations.json`, add an `attachments` block after `row`:

```json
  "attachments": {
    "title": "Comprovativos",
    "manage": "Comprovativos",
    "add": "Anexar ficheiro",
    "download": "Transferir {{filename}}",
    "delete": "Eliminar {{filename}}",
    "confirmDelete": "Eliminar {{filename}}? Não há forma de o recuperar.",
    "empty": "Ainda não há comprovativos anexados.",
    "uploading": "A carregar…",
    "close": "Fechar",
    "hint": "PDF, PNG ou JPEG, até 10 MB."
  },
```

and the same block in `apps/web/src/i18n/locales/en/obligations.json`:

```json
  "attachments": {
    "title": "Receipts",
    "manage": "Receipts",
    "add": "Attach a file",
    "download": "Download {{filename}}",
    "delete": "Delete {{filename}}",
    "confirmDelete": "Delete {{filename}}? There is no way to get it back.",
    "empty": "No receipts attached yet.",
    "uploading": "Uploading…",
    "close": "Close",
    "hint": "PDF, PNG or JPEG, up to 10 MB."
  },
```

`download` and `delete` are interpolated because they label controls that repeat per row: "Download" five times over is unusable with a screen reader (`docs/design/guidelines.md` §3).

The panel also uses `common:actions.delete`, which **does not exist yet** — `apps/web/src/i18n/locales/pt/common.json`'s `actions` block has save, cancel, create, edit, archive, restore, signIn, signOut and lockVault, but no delete. Add it to both locales in this same step:

```json
    "delete": "Eliminar",
```

```json
    "delete": "Delete",
```

- [ ] **Step 2: Write the failing panel tests**

Create `apps/web/src/obligations/ObligationAttachments.test.tsx`, following `ObligationsSection.test.tsx`'s mock-and-render idiom:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const listAttachmentsMock = vi.hoisted(() => vi.fn())
const uploadAttachmentMock = vi.hoisted(() => vi.fn())
const deleteAttachmentMock = vi.hoisted(() => vi.fn())
vi.mock('./attachmentsApi', () => ({
  listAttachments: listAttachmentsMock,
  uploadAttachment: uploadAttachmentMock,
  deleteAttachment: deleteAttachmentMock,
  attachmentDownloadUrl: (obligationId: string, id: string) => `/api/v1/obligations/${obligationId}/attachments/${id}`,
}))

const { ObligationAttachments } = await import('./ObligationAttachments')

await initI18n()
await i18next.changeLanguage('pt-PT')

const obligation = {
  id: 'o1',
  clientId: 'c1',
  clientName: 'Padaria Central, Lda.',
  definitionCode: 'VAT_MONTHLY_RETURN',
  definitionName: 'Declaração periódica de IVA',
  authority: 'TAX',
  periodLabel: '2026-01',
  dueDate: '2026-03-20',
  dueDateOverridden: false,
  status: 'DONE',
  completedAt: '2026-03-18T09:00:00.000Z',
  reference: null,
  amountCents: null,
  notes: null,
}

const attachment = {
  id: 'a1',
  obligationId: 'o1',
  filename: 'Declaração periódica.pdf',
  contentType: 'application/pdf',
  sizeBytes: 34567,
  uploadedAt: '2026-03-18T09:05:00.000Z',
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ObligationAttachments obligation={obligation} onClose={() => {}} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  listAttachmentsMock.mockReset().mockResolvedValue([])
  uploadAttachmentMock.mockReset()
  deleteAttachmentMock.mockReset()
  vi.restoreAllMocks()
})

describe('ObligationAttachments', () => {
  it('lists each attachment with a download link to the API route', async () => {
    listAttachmentsMock.mockResolvedValue([attachment])

    renderPanel()

    const link = await screen.findByRole('link', { name: /transferir declaração periódica\.pdf/i })
    expect(link).toHaveAttribute('href', '/api/v1/obligations/o1/attachments/a1')
    expect(link).toHaveAttribute('download')
  })

  // Most obligations will never have a receipt, so an EmptyState here would
  // be decoration on a non-event (docs/design/guidelines.md §2).
  it('shows a plain sentence and the affordance when there is nothing attached', async () => {
    renderPanel()

    expect(await screen.findByText(/ainda não há comprovativos/i)).toBeVisible()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByLabelText(/anexar ficheiro/i)).toBeVisible()
  })

  it('uploads the chosen file and refreshes the list', async () => {
    uploadAttachmentMock.mockResolvedValue(attachment)
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'recibo.pdf', { type: 'application/pdf' })

    renderPanel()

    await userEvent.upload(await screen.findByLabelText(/anexar ficheiro/i), file)

    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalledWith('o1', file))
    await waitFor(() => expect(listAttachmentsMock).toHaveBeenCalledTimes(2))
  })

  it('accepts only the three permitted types on the input', async () => {
    renderPanel()

    expect(await screen.findByLabelText(/anexar ficheiro/i)).toHaveAttribute(
      'accept',
      'application/pdf,image/png,image/jpeg',
    )
  })

  it('refuses an oversized file without calling the server', async () => {
    const tooBig = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.pdf', { type: 'application/pdf' })

    renderPanel()

    await userEvent.upload(await screen.findByLabelText(/anexar ficheiro/i), tooBig)

    expect(uploadAttachmentMock).not.toHaveBeenCalled()
    expect(await screen.findByText(/excede o limite/i)).toBeVisible()
  })

  it('confirms before deleting, and does nothing when the operator declines', async () => {
    listAttachmentsMock.mockResolvedValue([attachment])
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /eliminar declaração periódica\.pdf/i }))

    expect(window.confirm).toHaveBeenCalled()
    expect(deleteAttachmentMock).not.toHaveBeenCalled()
  })

  it('deletes when the operator confirms', async () => {
    listAttachmentsMock.mockResolvedValue([attachment])
    deleteAttachmentMock.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /eliminar declaração periódica\.pdf/i }))

    await waitFor(() => expect(deleteAttachmentMock).toHaveBeenCalledWith('o1', 'a1'))
  })

  it("shows the server's message when the file is gone", async () => {
    listAttachmentsMock.mockRejectedValue(
      Object.assign(new Error('attachments.file_missing'), {
        name: 'ApiError',
        code: 'attachments.file_missing',
        params: {},
        status: 410,
      }),
    )

    renderPanel()

    expect(await screen.findByText(/não está no servidor/i)).toBeVisible()
  })
})
```

- [ ] **Step 3: Write the failing row and section tests**

Append to `apps/web/src/obligations/ObligationsSection.test.tsx`:

```tsx
describe('attachments', () => {
  it('opens the panel for the row whose receipts button was pressed', async () => {
    listObligationsMock.mockResolvedValue([{ ...obligation, status: 'DONE' }])

    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^comprovativos$/i }))

    expect(await screen.findByRole('region', { name: /comprovativos/i })).toBeVisible()
  })

  it('shows no receipts count badge when the obligation has none', async () => {
    listObligationsMock.mockResolvedValue([{ ...obligation, status: 'DONE' }])

    renderSection()

    await screen.findByRole('button', { name: /^comprovativos$/i })
    expect(screen.queryByTestId('attachment-count')).toBeNull()
  })

  // Design §3.7: requiring DONE would force the operator to mark an
  // obligation done before filing the proof that it is done. The UI leads
  // with the affordance on a DONE row because that is when a receipt
  // exists; nothing rejects an earlier upload.
  it('offers the panel on a PENDING obligation too', async () => {
    listObligationsMock.mockResolvedValue([obligation])

    renderSection()

    expect(await screen.findByRole('button', { name: /^comprovativos$/i })).toBeVisible()
  })
})
```

This test needs `./attachmentsApi` mocked in that file too — add it beside the existing `vi.mock('./api', ...)`:

```tsx
vi.mock('./attachmentsApi', () => ({
  listAttachments: vi.fn().mockResolvedValue([]),
  uploadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  attachmentDownloadUrl: () => '#',
}))
```

- [ ] **Step 4: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- ObligationAttachments ObligationsSection
```

Expected: FAIL — `Cannot find module './ObligationAttachments'`, and no "Comprovativos" button on the row.

- [ ] **Step 5: Write the panel**

Create `apps/web/src/obligations/ObligationAttachments.tsx`:

```tsx
import { useId, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ACCEPTED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import type { ObligationResponse } from './api'
import { attachmentDownloadUrl, deleteAttachment, listAttachments, uploadAttachment } from './attachmentsApi'

type Props = { obligation: ObligationResponse; onClose: () => void }

/** Kilobytes are the right unit here: every accepted file is under 10 MiB. */
function formatSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} kB`
}

export function ObligationAttachments({ obligation, onClose }: Props) {
  const { t, i18n } = useTranslation(['obligations', 'common'])
  const queryClient = useQueryClient()
  const titleId = useId()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [tooLarge, setTooLarge] = useState(false)

  const queryKey = ['obligation-attachments', obligation.id]
  const attachments = useQuery({ queryKey, queryFn: () => listAttachments(obligation.id) })

  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  const upload = useMutation({
    mutationFn: (file: File) => uploadAttachment(obligation.id, file),
    onSuccess: () => {
      // Clearing the input is what lets the same file be chosen twice in a
      // row: a change event never fires for an unchanged value.
      if (inputRef.current) inputRef.current.value = ''
      void invalidate()
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteAttachment(obligation.id, id),
    onSuccess: invalidate,
  })

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 rounded border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <h3 id={titleId} className="text-sm font-semibold">
          {t('obligations:attachments.title')} — {obligation.definitionName}
        </h3>
        <button type="button" onClick={onClose} className="text-xs underline">
          {t('obligations:attachments.close')}
        </button>
      </div>

      <ErrorMessage error={attachments.error} />
      <ErrorMessage error={upload.error} />
      <ErrorMessage error={remove.error} />
      {tooLarge && <p className="text-sm text-danger-700">{t('errors:attachments.too_large')}</p>}

      {attachments.isPending ? null : (attachments.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-slate-600">{t('obligations:attachments.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {attachments.data?.map((file) => (
            <li key={file.id} className="flex items-center justify-between gap-3 text-sm">
              <a
                href={attachmentDownloadUrl(obligation.id, file.id)}
                download={file.filename}
                aria-label={t('obligations:attachments.download', { filename: file.filename })}
                className="underline"
              >
                {file.filename}
              </a>
              <span className="text-slate-500">
                {formatSize(file.sizeBytes)} · {formatDate(file.uploadedAt.slice(0, 10), i18n.language as SupportedLocale)}
              </span>
              <button
                type="button"
                aria-label={t('obligations:attachments.delete', { filename: file.filename })}
                onClick={() => {
                  // The one irreversible action in this panel, and there is
                  // no undo behind it.
                  if (!window.confirm(t('obligations:attachments.confirmDelete', { filename: file.filename }))) return
                  remove.mutate(file.id)
                }}
                className="text-xs text-red-700 underline"
              >
                {t('common:actions.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <label htmlFor={inputId} className="text-sm font-medium">
        {t('obligations:attachments.add')}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={ACCEPTED_ATTACHMENT_TYPES.join(',')}
        disabled={upload.isPending}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          // Checked here as well as on the server: a 10 MiB upload that is
          // going to be rejected anyway should not be sent over a phone's
          // connection first.
          if (file.size > MAX_ATTACHMENT_BYTES) {
            setTooLarge(true)
            event.target.value = ''
            return
          }
          setTooLarge(false)
          upload.mutate(file)
        }}
        className="text-sm"
      />
      <p className="text-xs text-slate-500">{t('obligations:attachments.hint')}</p>
      {upload.isPending && <p className="text-xs text-slate-500">{t('obligations:attachments.uploading')}</p>}
    </section>
  )
}
```

`t('errors:attachments.too_large')` resolves without listing `errors` in the `useTranslation` array: `initI18n` loads every namespace at once (`resources: { 'pt-PT': pt, 'en-GB': en }` in `apps/web/src/i18n/index.ts`), and an explicit `ns:key` prefix reaches any loaded namespace. The local `tooLarge` sentence exists because this rejection never reaches the server, so no `ApiError` is produced for `ErrorMessage` to render — it is the one error in this panel that the browser raises on its own.

- [ ] **Step 6: Give the row its affordance**

In `apps/web/src/obligations/ObligationRow.tsx`, extend `Props`:

```tsx
  /** Omitted on the global dashboard, which is mark-done only (design doc §3.4); supplied by the per-client section. */
  onManageAttachments?: () => void
  /** Rendered as a count badge when above zero. Omitted means "not known here". */
  attachmentCount?: number
```

and render the control outside the `isActionable` block, since a `DONE` obligation is exactly when a receipt exists:

```tsx
      {onManageAttachments && (
        <button type="button" onClick={onManageAttachments} className="flex items-center gap-1 text-xs underline">
          {t('attachments.manage')}
          {attachmentCount !== undefined && attachmentCount > 0 && (
            <Badge tone="accent" data-testid="attachment-count">
              {attachmentCount}
            </Badge>
          )}
        </button>
      )}
```

with `import { Badge } from '../ui'` at the top. `Badge` never learns what an attachment is — the row picks the tone (`docs/design/guidelines.md` §5).

- [ ] **Step 7: Mount it in the section**

In `apps/web/src/obligations/ObligationsSection.tsx`, add the state beside `editing`:

```tsx
  const [attachmentsFor, setAttachmentsFor] = useState<ObligationResponse | null>(null)
```

pass the prop on each row:

```tsx
              onManageAttachments={() => setAttachmentsFor(obligation)}
```

and render the panel below the list, beside the existing `editing` block:

```tsx
      {attachmentsFor && (
        <ObligationAttachments obligation={attachmentsFor} onClose={() => setAttachmentsFor(null)} />
      )}
```

with `import { ObligationAttachments } from './ObligationAttachments'` at the top. `attachmentCount` is deliberately not wired yet: the list endpoint returns obligations, not counts, and adding a per-row query would issue one request per row. The prop exists so the count can arrive with 4b's reporting work without touching this component again.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
pnpm --filter @ledger-hq/web test -- ObligationAttachments ObligationsSection ObligationRow
pnpm --filter @ledger-hq/web i18n:check
pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS everywhere.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/obligations apps/web/src/i18n/locales
git commit -m "feat(web): attach, list and delete obligation receipts

The panel lives in the per-client section, not the dashboard: the
dashboard is mark-done triage, and filing a receipt is per-obligation
work. No EmptyState for a list most obligations will never fill.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: The backup, the drill, and the documents this makes wrong

**Files:**
- Modify: `docker/backup.sh:18-27`
- Modify: `docs/security-model.md:12-24` (the two mitigation sections)
- Modify: `docs/operations.md:102-148` (rollback), `:150-188` (restore drill), `:190-198` (what is stored where)
- Modify: `docs/design/roadmap.md` (Stage 3's screen list)
- Modify: `README.md`
- Test: `apps/web/e2e/obligations.spec.ts`

**Interfaces:** consumes everything above; produces nothing new.

- [ ] **Step 1: Write the failing E2E case**

Append a second test to `apps/web/e2e/obligations.spec.ts`, reusing that file's sign-in idiom verbatim. The suite runs at `workers: 1` against one shared backend, so the client name and NIF must be unused: `507555554` is checksum-valid under `packages/domain/src/identifiers/nif.ts` and taken by no other spec (the others use `123456789` and `5014426xx`).

```ts
test('attaches a receipt to an obligation, downloads it, and keeps it out of the service-worker cache', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel(/email/i).fill('paulo@example.com')
  await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
  const confirmPasswordField = page.getByLabel(/confirma/i)
  if (await confirmPasswordField.isVisible().catch(() => false)) {
    await confirmPasswordField.fill(MASTER_PASSWORD)
  }
  await page.getByRole('button', { name: /criar|entrar/i }).click()
  await expect(page.getByRole('link', { name: /clientes/i })).toBeVisible()

  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Padaria Central Anexos, Lda.')
  await page.getByLabel(/^nif$/i).fill('507555554')
  await page.getByRole('button', { name: /guardar/i }).click()
  await page.getByRole('button', { name: /guardar/i }).click() // fiscal profile defaults

  const obligations = page.getByRole('region', { name: /obrigações fiscais/i })
  await expect(page.getByRole('button', { name: /aplicar/i })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /aplicar/i }).click()
  await expect(obligations.getByText(/declaração periódica de iva/i).first()).toBeVisible()

  await obligations.getByRole('button', { name: /^comprovativos$/i }).first().click()
  const panel = page.getByRole('region', { name: /comprovativos/i })

  // A real, minimal PDF: the API sniffs the leading bytes and rejects
  // anything whose contents disagree with its declared type.
  await panel.getByLabel(/anexar ficheiro/i).setInputFiles({
    name: 'Declaração periódica.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'),
  })

  const link = panel.getByRole('link', { name: /transferir declaração periódica\.pdf/i })
  await expect(link).toBeVisible({ timeout: 15_000 })

  // It survives a reload, which is what proves it reached the server rather
  // than only the component's state.
  await page.reload()
  await obligations.getByRole('button', { name: /^comprovativos$/i }).first().click()
  await expect(panel.getByRole('link', { name: /transferir declaração periódica\.pdf/i })).toBeVisible()

  const href = await panel.getByRole('link', { name: /transferir/i }).first().getAttribute('href')
  const downloaded = await page.request.get(href!)
  expect(downloaded.status()).toBe(200)
  expect(downloaded.headers()['content-type']).toContain('application/pdf')
  expect(downloaded.headers()['content-disposition']).toContain(`filename*=UTF-8''Declara%C3%A7%C3%A3o`)

  // The receipt must not be sitting in the PWA read cache in plaintext.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 })
  const cachedUrls = await page.evaluate(async () => {
    const names = await caches.keys()
    const urls: string[] = []
    for (const name of names) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) urls.push(request.url)
    }
    return urls
  })
  expect(cachedUrls.filter((url) => /\/attachments\/[^/]+$/.test(url))).toEqual([])
})
```

`Buffer` is available in a Playwright spec (it runs in Node), so no import is needed beyond the file's existing ones.

- [ ] **Step 2: Run the E2E suite against an empty database**

```bash
docker compose exec postgres psql -U ledger -d postgres \
  -c 'DROP DATABASE IF EXISTS ledger_hq_e2e WITH (FORCE)' \
  -c 'CREATE DATABASE ledger_hq_e2e OWNER ledger'
export DATABASE_URL="postgresql://ledger:<password>@localhost:5432/ledger_hq_e2e"
pnpm --filter @ledger-hq/api exec prisma migrate deploy
pnpm --filter @ledger-hq/web test:e2e
```

Expected: PASS, both obligation specs. Every spec registers its own client, so this needs the throwaway database, not the development one.

- [ ] **Step 3: Back the files up alongside the dump**

In `docker/backup.sh`, add a second artifact after the `ARCHIVE` line:

```bash
FILES_ARCHIVE="${BACKUP_LOCAL_DIR}/ledger-hq-${STAMP}.files.tar.age"
```

and a second block after the `pg_dump` `if/else`, before the `SystemHealth` insert:

```bash
# The two artifacts share ${STAMP} on purpose: different stamps describe
# different moments, and restoring across them produces exactly the orphan
# files and orphan rows the runbook's reconciliation looks for.
if docker compose exec -T api tar -cf - -C /var/lib/ledger-hq attachments \
    | age --recipient "${BACKUP_AGE_RECIPIENT}" --output "${FILES_ARCHIVE}"
then
  find "${BACKUP_LOCAL_DIR}" -name 'ledger-hq-*.files.tar.age' -mtime +30 -delete
  rclone copy "${FILES_ARCHIVE}" "${BACKUP_REMOTE}" || { STATUS="FAILED"; DETAIL="offsite copy failed"; }
else
  STATUS="FAILED"
  DETAIL="attachment archive failed"
  rm -f "${FILES_ARCHIVE}"
fi
```

Placing it before the insert is what makes a failure of either half report the night as `FAILED` through the existing `GET /api/v1/system/health-report`.

- [ ] **Step 4: Check the script still parses**

```bash
bash -n docker/backup.sh && shellcheck docker/backup.sh || bash -n docker/backup.sh
```

Expected: no syntax error. `shellcheck` may not be installed; `bash -n` alone is the floor.

- [ ] **Step 5: Amend the security model**

In `docs/security-model.md`, **"What is mitigated"** currently ends by carving out the offline client-register cache. Replace that closing paragraph's last sentence so it names two carve-outs rather than implying one:

```markdown
This does **not** extend to the plaintext client register cached for
offline reads, nor to obligation attachments stored on the server — see
the next section for both. An office machine and a lost phone are exposed
identically for the first; the second is exposed by disk access to the
server itself. Neither is part of what this section covers.
```

Then add this bullet to **"What is not mitigated"**, immediately after the cached-client-register bullet:

```markdown
- **Submission receipts stored on the server, in plaintext.** Obligation
  attachments (Phase 4c) are written to the `attachments-data` volume as the
  bytes that were uploaded — no vault envelope, no encryption at rest beyond
  whatever the host's own disk encryption provides. Disk-level access to the
  server, or an unencrypted copy of that volume, yields every receipt in
  full. This is deliberate: a receipt records a submission the tax authority
  also holds, so encrypting it would protect data the counterparty already
  has while making it unreadable in exactly the recovery scenario backups
  exist for. The nightly backup copy *is* encrypted (`age`,
  `docker/backup.sh`); the live volume is not.
```

- [ ] **Step 6: Amend the runbook — rollback**

In `docs/operations.md`'s **Rollback** section, add a step between the current step 3 and step 4:

```bash
# 3b. Restore the matching attachment archive. The timestamp MUST be the
#     same one as the dump above: a dump and a file archive from different
#     nights leave rows whose files are missing, and files no row knows
#     about.
age --decrypt -i /path/to/age-private-key.txt \
  -o /tmp/rollback-files.tar \
  "${BACKUP_LOCAL_DIR}/ledger-hq-<timestamp>.files.tar.age"
docker compose up -d api
docker cp /tmp/rollback-files.tar "$(docker compose ps -q api)":/tmp/rollback-files.tar
docker compose exec -T api sh -c 'rm -rf /var/lib/ledger-hq/attachments && tar -xf /tmp/rollback-files.tar -C /var/lib/ledger-hq'

# Clean up the decrypted archive on both the host and inside the container —
# it is plaintext and must not linger in either place.
rm -f /tmp/rollback-files.tar
docker compose exec -T api rm -f /tmp/rollback-files.tar
```

- [ ] **Step 7: Amend the runbook — restore drill**

In the **Restore drill (quarterly)** section, add a step after the current step 3 (the row-count comparison), so the drill proves the attachments restore too:

```bash
# 3b. Reconcile the attachment rows against the files on disk, in both
#     directions. Neither list should surprise you.
docker compose exec -T postgres psql -U "${POSTGRES_USER}" -d restore_drill -At \
  -c 'SELECT "obligationId" || $$/$$ || id FROM "ObligationAttachment"' | sort > /tmp/rows.txt
docker compose exec -T api sh -c 'cd /var/lib/ledger-hq/attachments && find . -type f -printf "%P\n"' \
  | sort > /tmp/files.txt

# On disk, not in the database: a failed upload or a stale restore. Harmless
# — every read starts from a row — and safe to delete.
comm -13 /tmp/rows.txt /tmp/files.txt

# In the database, not on disk: the download answers
# `attachments.file_missing` (410) and the UI says so. These rows are NOT
# deleted: the row is the only remaining record of what the receipt was
# called, which is what you need to fetch it again from the portal.
comm -23 /tmp/rows.txt /tmp/files.txt

rm -f /tmp/rows.txt /tmp/files.txt
```

- [ ] **Step 8: Amend the runbook — what is stored where**

Add one row to that table, after the "Live database" row:

```markdown
| Obligation attachments | `attachments-data` Docker volume, on this host | Plaintext — see [`docs/security-model.md`](security-model.md). Backed up nightly as a second `age`-encrypted artifact sharing the dump's timestamp; restore the two together. |
```

- [ ] **Step 9: Name the panel in the design roadmap**

In `docs/design/roadmap.md`, under **Stage 3 — Client detail page**, add `ObligationAttachments` to the screen list so the refresh does not finish with one unstyled panel:

```markdown
  `ObligationsSection` (with `AddAdHocObligationForm`,
  `AdjustObligationForm` and `ObligationAttachments` — the receipts panel
  added in Phase 4c, built against this section's pre-refresh markup and
  restyled here alongside its siblings; a candidate for `Dialog`);
```

- [ ] **Step 10: Update the README's phase list**

In `README.md`, extend the implemented-phases sentence so 4c is named:

```markdown
and **Phase 4c — Obligation Attachments** (submission receipts stored
against an obligation, on a volume beside the database and in the nightly
backup).
```

- [ ] **Step 11: Run the full gate**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @ledger-hq/api test:integration
pnpm --filter @ledger-hq/web i18n:check
bash -n docker/backup.sh
docker compose config >/dev/null
```

Expected: PASS, all of it.

- [ ] **Step 12: Commit**

```bash
git add apps/web/e2e/obligations.spec.ts docker/backup.sh docs README.md
git commit -m "test(web): prove a receipt attaches, downloads, and stays uncached

Also extends the nightly backup to the attachments volume, and amends
the three documents this phase makes wrong: the security model now
names plaintext receipts under what is NOT mitigated, the runbook
restores and reconciles the file archive alongside the dump, and the
design roadmap names the panel Stage 3 has to restyle.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
