# Phase 4c — Obligation Attachments Design

- **Date:** 2026-09-29
- **Status:** Approved
- **Author:** Design session with the product owner

## 1. Context

Phase 4 decomposes into three sub-phases (see the [Phase 4a
spec](2026-09-28-phase-4a-client-credit-design.md), §2). This specifies the
third.

The master spec leaves it explicitly open: "Should completed obligations
support file attachments (submission receipts)? Deferred to Phase 4 unless
raised earlier" (§16.2). The design session raised it. An `ObligationInstance`
carries `reference` and `notes`, so the *number* of a submission can be
recorded but the receipt cannot, and proof lives in a mail client, a scanner
folder or on paper — the "scattered across notes and memory" problem the
product exists to end.

This is the first subsystem storing bytes outside Postgres, so most of this
document is about where those bytes live, who can read them, and what happens
to them at backup and restore time.

## 2. Scope

In: uploading, listing, downloading and deleting files attached to an
`ObligationInstance`; their storage on disk; their place in the nightly backup;
restore reconciliation in both directions; and the amendments
`docs/security-model.md` and `docs/operations.md` need as a consequence.

Out: attachments on any other entity — a charge, a payment, a client (nothing
asked for them, and each needs its own retention answer); OCR or parsing of
contents; thumbnails and in-app preview (§3.8); versioning an attachment, since
re-upload and delete suffice — a receipt is not rotated the way a credential
is; search inside attachment contents, which belongs to 4b and is not promised
there either; and everything in 4a and 4b.

## 3. Decisions

### 3.1 Bytes on disk, in plaintext — not in the vault

Phase 1 sets the instinct that anything sensitive gets the zero-knowledge
treatment. Attachments deliberately do not.

A vault credential is a live secret: holding it lets an attacker act as the
practice against a tax portal. A receipt records something already done, and
the tax authority holds its own copy — in a dispute, theirs is authoritative.
Encrypting it buys confidentiality of data the counterparty already has, and
costs two properties that matter more. **Emergency readability:**
`docs/security-model.md` warns the master password and recovery code can both
be lost permanently, and vault-encrypted receipts would die with them; plaintext
is readable from a restored backup with the `age` key alone, stored separately.
**Unlock-free access:** otherwise the vault must be unlocked to look at a
receipt, on a screen with nothing else to do with credentials.

**What an attacker with filesystem access gains:** every receipt's contents —
typically a client name, tax number, obligation, period and amount. What it
does not change: they already had the whole client register in plaintext from
the Postgres volume, including tax numbers, social security numbers, dates of
birth and notes. Receipts add document images of facts already in the database
next door, not a new class of secret. No credential material reaches disk in
the clear.

`docs/security-model.md` is not wrong today but becomes wrong the moment this
ships: "What is mitigated" claims disk access hands the attacker only
ciphertext and hashes. **Required edit** — add to "What is not mitigated",
after the cached-client-register bullet:

> - **Submission receipts stored on the server, in plaintext.** Obligation
>   attachments (Phase 4c) are written to the `attachments-data` volume as the
>   bytes that were uploaded — no vault envelope, no encryption at rest beyond
>   whatever the host's own disk encryption provides. Disk-level access to the
>   server, or an unencrypted copy of that volume, yields every receipt in
>   full. This is deliberate: a receipt records a submission the tax authority
>   also holds, so encrypting it would protect data the counterparty already
>   has while making it unreadable in exactly the recovery scenario backups
>   exist for. The nightly backup copy *is* encrypted (`age`,
>   `docker/backup.sh`); the live volume is not.

"What is mitigated" must also lose its implication of completeness — it already
carves out the offline client-register cache, and this is a second carve-out to
name in the same place.

### 3.2 One table; the path is derived from the row's own id

```prisma
model ObligationAttachment {
  id           String   @id @db.Uuid
  obligationId String   @db.Uuid
  filename     String
  contentType  String
  sizeBytes    Int
  sha256       String
  uploadedAt   DateTime @default(now()) @db.Timestamptz(3)

  obligation ObligationInstance @relation(fields: [obligationId], references: [id], onDelete: Cascade)

  @@index([obligationId])
}
```

`ObligationInstance` gains `attachments ObligationAttachment[]`.

**There is no `storagePath` column** — a stored path is a second source of
truth that can disagree with the first. The path is a pure function of the row,
and `id` is a `uuidv7` like every other id here:

```ts
// apps/api/src/attachments/file-storage.service.ts
pathFor(obligationId: string, attachmentId: string): string {
  return join(this.root, obligationId, attachmentId)
}
```

**The user's filename is never part of the path.** It arrives as an arbitrary
string: `../../etc/passwd` escapes the directory, names differing only in case
collide on a case-insensitive filesystem, Unicode normalisation makes two
visually identical names collide or not depending on platform, and 300
characters exceeds `NAME_MAX` on ext4. The uploaded name is data — stored in
`filename`, emitted only in `Content-Disposition` (§3.5), never passed to
`join()`.

`onDelete: Cascade` matches every other `Client`-rooted relation. Deleting an
obligation removes the rows and leaves the files; §4.3 reclaims them.

### 3.3 The file is written first, the row second

One request creates two things in two systems with no transaction spanning
them. The order follows from which failure is survivable. **File first:** a
failed row write leaves a file nothing references — invisible to every reader,
reclaimed by the sweep (§4.3). **Row first:** a failed file write leaves a row
whose download returns nothing; the attachment is listed, is clickable, and
fails when clicked, so the operator believes they have a receipt they do not
have. A wasted block of disk against a lie about evidence — file first.

The write is atomic against a crash mid-stream: bytes go to `<path>.tmp` and
are `rename()`d into place, so a half-written file is never visible under the
real name. Delete runs the reverse order for the same reason.

### 3.4 Types and size, enforced on the bytes and not the label

**Accepted:** `application/pdf`, `image/png`, `image/jpeg` — a portal PDF, or a
phone photo of a stamped counterfoil. Every extra type is another format the
download route can be talked into serving.

**Cap: 10 MiB** (`10 * 1024 * 1024`). A portal PDF is tens of kilobytes, a
phone photo two to five megabytes; ten leaves headroom for a multi-page scan
without letting a mis-click park a video on the volume.

A multipart part's declared `Content-Type` is chosen by the client and is not
evidence. The service sniffs the leading bytes and requires agreement: `%PDF-`
(`25 50 44 46 2D`), `89 50 4E 47` (PNG), `FF D8 FF` (JPEG). A mismatch is
rejected exactly as an unaccepted type is. Three codes join `ERROR_CODES` in
`packages/domain/src/errors.ts`, per ADR 0004:

```ts
'attachments.type_not_allowed',   // 415, params: { contentType }
'attachments.too_large',          // 413, params: { maxBytes }
'attachments.file_missing',       // 410, params: { attachmentId }
```

`attachments.file_missing` is the honest answer when a row survives a restore
its file did not (§4.3) — a translatable message instead of a 500 that reads
like a bug.

Multer enforces the cap before the body is fully buffered and signals it with
`MulterError('LIMIT_FILE_SIZE')`, which is not an `AppError` and would be
flattened to `common.validation_failed` by `AppErrorFilter`. A
`@Catch(MulterError)` filter on the controller maps `LIMIT_FILE_SIZE` to
`attachments.too_large` and anything else to `common.validation_failed`,
keeping the code-only envelope.

### 3.5 Routes: through the API, never off Caddy

```
POST   /api/v1/obligations/:obligationId/attachments        multipart/form-data, field "file"
GET    /api/v1/obligations/:obligationId/attachments        -> AttachmentResponse[]
GET    /api/v1/obligations/:obligationId/attachments/:id    -> the bytes
DELETE /api/v1/obligations/:obligationId/attachments/:id    -> 204

type AttachmentResponse = {
  id: string; obligationId: string; filename: string
  contentType: string; sizeBytes: number; uploadedAt: string   // ISO-8601
}
```

`sha256` is not in the response: it exists for restore reconciliation (§4.3).

**The volume is mounted into the `api` service only.** Serving files off
Caddy's `file_server` would be one line and would defeat the login:
`docker/Caddyfile` serves the static bundle with no authentication, because the
bundle is public code. A receipt is not. Every byte leaves through a route
behind `SessionGuard`, and the `web` container never sees the volume.

The download route sets, explicitly:

```
Content-Type: <the row's contentType>
Content-Disposition: attachment; filename="<ascii-folded>"; filename*=UTF-8''<percent-encoded>
```

Always `attachment`, never `inline` (§3.8). The RFC 5987 `filename*` carries
`Declaração periódica — 2026Q1.pdf` intact; the plain `filename` is the ASCII
fallback. `X-Content-Type-Options: nosniff` already rides on every API response
via `helmet()` in `apps/api/src/main.ts` — no extra header, but the route
depends on it.

Upload is a non-safe method and passes `CsrfGuard`, which requires
`X-Requested-With: ledger-hq`. `apiFetch` always sets
`Content-Type: application/json`, which a multipart body must not carry — the
browser sets its own boundary. The web client therefore gains a second, narrow
helper beside `apiFetch` (§5), which sends the CSRF header itself.

### 3.6 A new module, because the filesystem is a new concern

Attachments get `apps/api/src/attachments/`, not another file in
`obligations/`. The routes hang off an obligation and the table cascades from
one, but the interesting code is a directory, a temp-file rename, byte sniffing
and a multer error — none of it obligation knowledge. `AttachmentsModule`
imports `ObligationsModule` to resolve the parent, as `ObligationsModule`
imports `ClientsModule` today.

`ATTACHMENTS_DIR` is validated by `validateEnv`
(`apps/api/src/common/env-validation.ts`), which already refuses to boot
without `AUTH_SALT_SECRET`, for the same reason: a missing directory that fails
lazily fails on the first upload, in production, months later. The service
`mkdir -p`s it at construction and fails the boot if that throws.

### 3.7 No status constraint on the parent obligation

An attachment can be added in any status. Requiring `DONE` would force the
operator to mark an obligation done before filing the proof that it is done —
a two-step dance for no benefit. The UI leads with the affordance on a `DONE`
row because that is when a receipt exists; nothing rejects an earlier upload.

### 3.8 No preview, and what the CSP has to do with it

`docker/Caddyfile` serves the shell under `default-src 'self'; ... object-src
'none'; frame-ancestors 'none'`. That CSP rides on the HTML document, not on an
API response, so it does not govern a downloaded file directly — but it governs
every way the page could display one. `object-src 'none'` blocks `<object>` and
`<embed>`, the two classic PDF embeds, and rendering a PDF in an `<iframe>`
from a blob URL is both awkward under `default-src 'self'` and a way to run a
hostile PDF's JavaScript in an origin holding an unlocked vault session. So: no
in-app preview. `attachment` disposition hands the file to the operating
system's own viewer, outside the page's origin.

### 3.9 Downloads must not enter the PWA read cache

`apps/web/vite.config.ts` caches every `GET /api/v1/*` under `NetworkFirst` for
24 hours, in Cache Storage, in plaintext — the gap `docs/security-model.md`
already names. Left alone, that rule copies every downloaded receipt onto every
device that opens one. The download route gets its own `NetworkOnly` rule
*ahead* of the generic one, following the precedent and the ordering comment
the `/api/v1/auth/vault-envelope` rule already establishes (Workbox matches in
array order, first match wins):

```ts
{
  urlPattern: ({ url, request }) =>
    /^\/api\/v1\/obligations\/[^/]+\/attachments\/[^/]+$/.test(url.pathname) && request.method === 'GET',
  handler: 'NetworkOnly' as const,
},
```

The *list* route stays on `NetworkFirst`: filenames and sizes are metadata of
the kind the client register already caches.

## 4. Operations

### 4.1 The volume

`docker-compose.yml` gains a named volume and one mount, on `api` only:

```yaml
  api:
    environment:
      ATTACHMENTS_DIR: /var/lib/ledger-hq/attachments
    volumes:
      - attachments-data:/var/lib/ledger-hq/attachments

volumes:
  postgres-data:
  attachments-data:
```

Local development points `ATTACHMENTS_DIR` at a gitignored path under the
checkout; `.env.example` and `apps/api/.env.example` both gain the variable.

### 4.2 The nightly backup

`docker/backup.sh` gains a second artifact sharing the dump's stamp, after the
dump block and before the `SystemHealth` insert, so a failure of either half
reports the night as `FAILED` through the existing
`GET /api/v1/system/health-report`:

```bash
FILES_ARCHIVE="${BACKUP_LOCAL_DIR}/ledger-hq-${STAMP}.files.tar.age"

if docker compose exec -T api tar -cf - -C /var/lib/ledger-hq attachments \
    | age --recipient "${BACKUP_AGE_RECIPIENT}" --output "${FILES_ARCHIVE}"
then
  :
else
  STATUS="FAILED"
  DETAIL="attachment archive failed"
  rm -f "${FILES_ARCHIVE}"
fi
```

The prune extends to the new glob
(`find ... -name 'ledger-hq-*.files.tar.age' -mtime +30 -delete`) and the
`rclone copy` sends both. **The two are a pair** — different stamps describe
different moments, and restoring across them produces exactly the orphans §4.3
is about.

### 4.3 Reconciliation, both directions

**Orphan file** — bytes with no row. Harmless and invisible: every read path
starts from a row. A failed upload (§3.3) leaves one too, so the sweep is
useful outside restores. The runbook documents it as a comparison of two
listings, deleting only what the database does not know:

```bash
docker compose exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -At \
  -c 'SELECT "obligationId" || $$/$$ || id FROM "ObligationAttachment"' | sort > /tmp/rows.txt
docker compose exec -T api sh -c 'cd /var/lib/ledger-hq/attachments && find . -type f -printf "%P\n"' \
  | sort > /tmp/files.txt
comm -13 /tmp/rows.txt /tmp/files.txt   # on disk, not in the database — safe to delete
comm -23 /tmp/rows.txt /tmp/files.txt   # in the database, not on disk — see below
```

**Orphan row** — a row whose file is gone. Not silent: the download returns
`attachments.file_missing` (410) and the UI says so in words. These rows are
deliberately **not** auto-deleted — the row is the only remaining evidence that
a receipt existed and what it was called, which is what the operator needs to
fetch it again from the portal. `sha256` makes the check stronger than
presence: the same listings plus a `sha256sum` pass prove the file on disk is
the file the row describes.

`docs/operations.md` needs three edits. The **restore drill** runs the
reconciliation above against the throwaway restore after its row-count step, so
the drill proves the attachments restore too. **Rollback** gains the matching
`ledger-hq-<timestamp>.files.tar.age`, extracted into the volume, with the
matching-stamp warning and the same "clean up the decrypted artifact on both
the host and inside the container" step the dump already has. **What is stored
where** gains a row: `Obligation attachments` | `attachments-data` Docker
volume, on this host | Plaintext; in the nightly backup as a second
`age`-encrypted artifact sharing the dump's timestamp.

## 5. Module layout

```
packages/domain/src/
  errors.ts                       three attachments.* codes (§3.4)
  schemas/attachments.ts          route param schemas

apps/api/src/attachments/
  attachments.module.ts           imports AuthModule, ObligationsModule
  attachments.controller.ts       the four routes (§3.5)
  attachments.service.ts          row + file orchestration, sniffing, ordering (§3.3)
  file-storage.service.ts         root dir, pathFor, atomic write, read, unlink
  multer-error.filter.ts          MulterError -> attachments.too_large (§3.4)

apps/web/src/
  api/upload.ts                   multipart POST helper beside apiFetch (§3.5)
  obligations/attachmentsApi.ts   list / upload / download / delete
  obligations/ObligationAttachments.tsx   the panel (§6)
```

`apps/api/package.json` gains `multer` and `@types/multer`;
`@nestjs/platform-express` already provides `FileInterceptor`.

## 6. UI

Attachments appear in the per-client `ObligationsSection`, not on the global
`ObligationsDashboard` — the dashboard is deliberately mark-done only (Phase 2
design doc §3.4, restated in `ObligationRow`'s own comment on `onEdit`), and
filing a receipt is per-obligation work, not triage.

The section follows the idiom it already has for editing: a second piece of
state beside `editing`, and an optional `ObligationRow` prop supplied only by
the section, exactly as `onEdit` is today.

```tsx
const [attachmentsFor, setAttachmentsFor] = useState<ObligationResponse | null>(null)
// ObligationRow: onManageAttachments?: () => void
```

`ObligationAttachments` renders below the list
when a row is selected: an `<ul>` of filename, size and date with a download
link and a delete control per row, plus a file input. **A completed obligation
with no attachment shows the affordance and nothing else** — no `EmptyState`,
which the guidelines reserve for a list that is empty when it might not have
been; most obligations will never have a receipt.

**Interaction with UI-refresh Stage 3.** `docs/design/roadmap.md` puts
`ObligationsSection` and its two forms in Stage 3, where `Dialog` also arrives.
Either can land first: **4c first**, the panel is built with the section's
current markup and Stage 3 restyles it alongside its siblings — Stage 3's
screen list must gain it, or the refresh finishes with one unstyled panel;
**Stage 3 first**, the panel is a `Dialog` from the start, on Stage 2's form
primitives. Either way the roadmap needs a line under Stage 3 naming it.

**i18n.** New keys under the existing `obligations` namespace in both `pt-PT`
and `en-GB`, covered by `pnpm --filter @ledger-hq/web i18n:check`:
`attachments.title`, `.add`, `.download`, `.delete`, `.empty`, `.uploading`,
plus the three new codes in `errors.json`. Every icon-only control carries a
translated `aria-label`.

## 7. Testing

- **`file-storage.service`** — `pathFor` never escapes the root, including for
  an id-shaped string containing `..`; a successful atomic write leaves no
  `.tmp`; a read of a missing path raises rather than returning empty.
- **Type and size** — a PNG declared as `application/pdf` is rejected with
  `attachments.type_not_allowed`; a 10 MiB + 1 byte upload is rejected with
  `attachments.too_large` and leaves no file on disk.
- **Ordering (§3.3)** — with the row write stubbed to fail the request fails,
  nothing is listed, and the orphan file is present (proving the chosen order);
  with the file write stubbed to fail, no row exists.
- **Integration** (Testcontainers,
  `apps/api/test/attachments.integration.test.ts`, the
  `billing.integration.test.ts` pattern) — upload, list, download the exact
  bytes back, delete; deleting the parent obligation cascades the rows; a
  download whose file was removed answers 410 `attachments.file_missing`, not
  500; an upload without `X-Requested-With` is rejected as `common.forbidden`;
  every route without a session cookie answers `auth.session_expired`.
- **`Content-Disposition`** — a filename containing `"`, a newline and
  non-ASCII characters produces a well-formed header with an intact
  `filename*`, and that name never appears in the path on disk.
- **Web** — the panel renders the list, no receipts-count badge is rendered
  (there is no count in the obligations list response to drive one), the
  delete control confirms first, and the upload helper sends
  `X-Requested-With` but **not** a JSON `Content-Type`.
- **E2E** — attach a PDF, reload, confirm it is listed and downloadable, and
  assert the download is not served from the service-worker cache (§3.9).

## 8. Risks

| Risk | Mitigation |
|---|---|
| The volume fills and uploads fail | The 10 MiB cap bounds one upload; growth is otherwise slow. Disk-full surfaces as `common.internal_error`, not silent loss, because the row is written second. |
| The backup outgrows the offsite remote | Every night ships every attachment. Worth revisiting past a few gigabytes; not before. |
| A restore mixes a dump and a file archive from different nights | The runbook states the stamps must match, and §4.3 detects it in both directions. |
| A hostile file uploaded through a compromised session | Single-user system; the session is the operator's own. Sniffing bounds what can be stored, and `attachment` disposition with no preview (§3.8) means the page never renders the bytes. |

## 9. Open questions

1. Should deleting an attachment be recorded in `AuditEvent`? It is the one
   irreversible action here and the log already exists. Left out because
   nothing else in obligations writes audit events, and adding one only for
   attachments would be an odd first entry — better as a deliberate pass over
   the whole module.
2. Should the attachment count appear on the global dashboard row as a
   "documented" signal — done *and* filed? Plausible, but it is a reporting
   question, and 4b is where cross-module signals get designed.
