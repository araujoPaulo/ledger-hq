# UI refresh, Stage 4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the two vault screens outside the client page — the Vault page (`PlatformsPage`) and first-run vault setup (`VaultSetupPage`) — on the design system, with the vault's state in the header, platform creation in a dialog, and the recovery code laid out for copying by hand.

**Architecture:** No new `ui/` components: this stage composes what Stages 1-3 shipped (`PageHeader`, `Card`, `DataList`, `Badge`, `EmptyState`, `Skeleton`, `Button`, `Input`, `Select`, `Checkbox`, `Dialog`, `Callout`, `useToast`) plus Stage 3's `vault/PlatformAvatar`. The inline create form moves out of `PlatformsPage` into `NewPlatformForm`, rendered in a `Dialog`. `copyAndClear` moves from `CredentialRow` into `vault/clipboard.ts` so the recovery code shares the 30-second clipboard clear. The Vault page reads the unlock gate's existing `['vault-envelope-resolved', email]` query to prompt for setup.

**Tech Stack:** React 19.2, TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Tailwind CSS v4 tokens, TanStack Router and Query, i18next, Radix (via the `ui/` wrappers), `lucide-react`, Vitest + Testing Library (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-ui-refresh-stage-4-design.md` — read it in full before Task 1. Component APIs come from `docs/superpowers/specs/2026-10-04-ui-refresh-stage-2-design.md` §5 (as implemented by `docs/superpowers/plans/2026-10-04-ui-refresh-stage-2.md` Tasks 3-6: `FieldProps` members admit `undefined`, `className`/`ref` land on the native control, `Select layout="inline"` forbids `hint`/`error`, `Button asChild` forbids `type`/`disabled`/`isLoading`) and `docs/superpowers/specs/2026-10-04-ui-refresh-stage-3-design.md` §5 and §7.5. Screens: <https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92>.

## Global Constraints

- **Stages 2 and 3 must be merged first.** This plan imports `Input`, `Select`, `Checkbox`, `Dialog`, `Callout`, `ToastProvider`, `useToast` from `apps/web/src/ui`, `PlatformAvatar` from `apps/web/src/vault/PlatformAvatar.tsx`, and `INACTIVITY_LOCK_MS` from `apps/web/src/vault/vault-session.ts`. Task 2 Step 1 verifies them; if any is missing, stop.
- **Presentation only.** No API change, no route change, no new `queryKey`. The one cache operation added (Task 8's `removeQueries` on `['vault-envelope-resolved']`) touches an existing key and exists to stop a stale "not set up" prompt — see Review Focus 1.
- **No credential count per platform** (spec §2.1) and **no platform editing** (spec §1). Do not add either.
- **The real auto-lock timeout is 5 minutes.** Interpolate it from `INACTIVITY_LOCK_MS`; never write "15".
- **No hardcoded user-visible strings**, `aria-label` included. ESLint's `i18next/no-literal-string` runs with `markupOnly: true`, so JSX text is caught but attributes are not — the `https://` URL placeholder is the only allowed literal (it is not language).
- **`pt-PT` copy uses the informal register and the app's existing vocabulary.** Every existing `pt` string addresses the user as *tu* ("Configura o cofre", "Indica um nome válido") and says *bloquear/desbloquear* ("Bloquear cofre", "Desbloquear"). The spec's §7 table follows the same rule (spec §2.6); Task 2 uses its copy, and the `en-GB` copy is the spec's, verbatim.
- **Tests assert Portuguese.** Every web test runs `await initI18n()` then `await i18next.changeLanguage('pt-PT')`.
- **Named exports only**; components set no margin on themselves; three gaps (`gap-4`, `gap-6`, `gap-8`); type scale `text-2xl`/`text-lg`/`text-base`/`text-sm`/`text-xs` only; weight 400 (`font-normal`) for prose only. The recovery-code cells are `text-lg` (spec §4.3), inside the scale.
- **Commit after every task**, `feat(web):` / `refactor(web):` / `test(web):` / `docs(design):` prefix, each message ending with the trailer line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

Five conditions most likely to bite first. Each has a test in the task that owns the code.

1. **The vault was just set up, then auto-locks.** The envelope query cached `setUp: false` before setup; once the vault locks again (5 minutes later) the Vault page must not tell the user to set up a vault they already have. Expected: no callout. → Task 6 (the page only trusts `setUp: false` while locked) and Task 8 (setup success removes the stale cache entry).
2. **Auto-lock fires while the Vault page is open.** The pill must flip from "Desbloqueado" to "Bloqueado" without a reload. → Task 6.
3. **No clipboard API.** The app is reached over Tailscale, possibly on plain HTTP, where `navigator.clipboard` does not exist; and a browser can deny the write. Copy must not show a "copied" toast it cannot honour, and must not throw. → Task 3 (`copyAndClear` rejects) and Task 7 (the display catches and stays quiet).
4. **Creating a platform fails** — most often `platforms.name_taken` (409). Expected: the dialog stays open, the typed name is still there, the server's message shows inside the dialog. → Task 4.
5. **A stored URL that does not parse** (no scheme, e.g. `portaldasfinancas.gov.pt`). Expected: the row shows the text as stored rather than throwing or dropping it. → Task 5.

---

## File Structure

```
apps/web/src/
  i18n/locales/{pt,en}/vault.json   Task 2: new keys, one copy change
  vault/
    clipboard.ts                    Task 3 (new): copyAndClear + CLIPBOARD_CLEAR_MS
    clipboard.test.ts               Task 3 (new)
    CredentialRow.tsx               Task 3: imports copyAndClear instead of defining it
    NewPlatformForm.tsx             Task 4 (new): the create form, rendered inside a Dialog
    PlatformsPage.tsx               Tasks 4-6: header, dialog, list, states, pill, setup callout
    PlatformsPageSkeleton.tsx       Task 5 (new)
    PlatformsPage.test.tsx          Tasks 4-6
    RecoveryCodeDisplay.tsx         Task 7 (new): grouped code grid + copy
    RecoveryCodeDisplay.test.tsx    Task 7 (new)
    VaultSetupPage.tsx              Task 8: two steps
    VaultSetupPage.test.tsx         Task 8
apps/web/e2e/
  vault-offline.spec.ts             Task 9: setup grid + platform dialog
  shell.spec.ts                     Task 9: mobile dialog check
docs/design/guidelines.md           Task 9
```

---

### Task 1: Draw the Stage 4 boards on the canvas

**Files:** none in the repository. The canvas <https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92> is the editable source for every UI refresh screen; the project memory records that it is iterated in place, never replaced, and that every screen exists in a desktop and a mobile frame.

**Interfaces:**
- Consumes: spec §3, §4 and §7 (the `en-GB` copy, which the boards use).
- Produces: the visual reference Tasks 4-8 match. Once drawn, the boards outrank the spec's prose where they disagree; a disagreement with this plan is raised, not guessed.

- [ ] **Step 1: Read the canvas before touching it**

It can be edited in the browser between sessions, and Stage 3's plan also adds boards to it. With the Artifact tool: `read` the artifact (its result carries the Design type's instructions — follow them exactly), `list` with `scope: "files"`, then `read` `project/canvas.json`, `project/Vault.dc.html`, `project/VaultMobile.dc.html`, and `project/Credentials.dc.html` (for the Stage 3 `Dialog`/`Callout` treatment, if Stage 3 drew them — reuse its look). Note the Vault row's `y` and the rightmost board's `x + w` in `canvas.json`.

- [ ] **Step 2: Redraw the two existing Vault boards**

Edit copies of `Vault.dc.html` (1440×1024) and `VaultMobile.dc.html` (390×844) under one scratch folder at their canvas paths:

- Desktop: delete the "New platform" side form; the header's action area holds the status pill **and** a primary "New platform" button with a plus icon. The list spans the full content width.
- Both: replace every "N credentials" text with the platform's URL host under its name (`portaldasfinancas.gov.pt`, `seg-social.pt`, `portaldaempresa.pt`, `bpinet.bpi.pt`), and show the authentication kind as a neutral tag badge on the right.
- Both: the pill reads "Unlocked · locks after 5 min" (desktop) / "Unlocked" (mobile, space-limited — keep the board's current short form), green pill per `Badge tone="success" shape="pill"`.
- Desktop and mobile titles read "Vault" with the description sentence; the list's heading reads "Platforms".
- Nav: four items (Deadlines, Clients, Vault, Reports) and the sidebar search box, as shipped — the boards predate Phase 4b.

- [ ] **Step 3: Add the new boards**

New files, each with the skeleton the type instructions give (keep the `support.js` head line exactly), real data from the existing boards, and the tokens in `apps/web/src/styles.css`:

| File | Size | Content |
|---|---|---|
| `VaultNewPlatform.dc.html` | 1440×1024 | the Vault page dimmed under the New platform dialog: title, Name, URL (placeholder `https://`), Authentication kind select, footer Cancel (ghost) + Create (primary); one variant of the Name field showing the error "A platform named Portal das Finanças already exists." |
| `VaultNewPlatformMobile.dc.html` | 390×844 | the same dialog at phone width, footer buttons stacked full width, primary first |
| `VaultStates.dc.html` | 1440×1024 | three stacked panels of the content area: loading (four skeleton rows: avatar block + two text lines + badge block), empty (`EmptyState`: globe icon, "No platforms yet", the hint, New platform button), and the not-set-up `Callout` above a short list |
| `VaultStatesMobile.dc.html` | 390×844 | the same three, one column |
| `VaultSetupConfirm.dc.html` | 1440×1024 | step 1: page title "Set up the vault", caption "Step 1 of 2", a card with the intro sentence, the "Confirm your master password" field, full-width Continue |
| `VaultSetupConfirmMobile.dc.html` | 390×844 | the same |
| `VaultSetupCode.dc.html` | 1440×1024 | step 2: caption "Step 2 of 2", a warning callout "Write this down now" with the intro sentence, the code as six monospace cells in a three-column grid (`K7QPM` `3RTXA` `WN5HD` `2ZBEC` `Y6JLF` `Q` — only `A-Z` and `2-7`, last group one character), a secondary "Copy code" button, the acknowledge checkbox, full-width Continue (disabled) and the toast "Code copied. The clipboard clears in 30 seconds." |
| `VaultSetupCodeMobile.dc.html` | 390×844 | the same, code grid in two columns |

Add each to `canvas.json`'s `boards` (in the Vault row, 80 px apart, continuing right of the last Vault-row board) and to `order`, keeping every other key as read.

- [ ] **Step 4: Publish once and report**

One Artifact publish call with `url` set to the canvas, `root` the scratch folder, `file_path` the absolute path of `project/canvas.json`, and every changed or new board in `files`. If it is refused because someone saved meanwhile, re-read the named files and redo the edit. Report the canvas link and the list of boards drawn. Do not render, screenshot or re-read to verify.

Nothing to commit.

---

### Task 2: Prerequisites and the Stage 4 translation keys

**Files:**
- Modify: `apps/web/src/i18n/locales/pt/vault.json`
- Modify: `apps/web/src/i18n/locales/en/vault.json`

**Interfaces:**
- Consumes: Stage 2/3 exports (verified in Step 1).
- Produces: `vault:platforms.description`, `vault:platforms.emptyHint` (Tasks 4-5); `vault:status.unlocked` (`{{minutes}}`), `vault:status.locked` (Task 6); `vault:setup.step` (`{{current}}`, `{{total}}`), `vault:setup.intro`, `vault:setup.recoveryCodeTitle` (Task 8); `vault:setup.recoveryCodeLabel`, `vault:setup.copyCode`, `vault:setup.codeCopied` (Task 7). `vault:platforms.empty` changes copy.

- [ ] **Step 1: Verify the Stage 2 and Stage 3 surface exists**

```bash
cd /Users/pauloaraujo/Projects/personal/ledger-hq
grep -nE "Input|Select|Checkbox|Dialog|Callout|ToastProvider|useToast" apps/web/src/ui/index.ts
grep -n "export const INACTIVITY_LOCK_MS" apps/web/src/vault/vault-session.ts
grep -n "export function PlatformAvatar" apps/web/src/vault/PlatformAvatar.tsx
sed -n '1,40p' apps/web/src/vault/PlatformAvatar.tsx
grep -n "title\|description\|size" apps/web/src/ui/Dialog.tsx | head -20
```

Expected: every export present. This plan assumes `PlatformAvatar` takes `{ name: string }`, `Dialog.Content` takes `title: string` (and optional `description`, `size`), `Dialog.Footer` and `Dialog.Close` exist, `useToast()` returns `{ toast }` where `toast({ title, tone })` accepts `tone: 'success'`, and `ToastProvider` renders its own viewport. If any shipped name differs, use the shipped name everywhere this plan uses the assumed one — the shipped component is the contract. If an export is missing entirely, stop: Stage 3 has not merged.

- [ ] **Step 2: Add the keys to `pt/vault.json`**

Inside `setup`, after `"title"`:

```json
    "title": "Configura o cofre",
    "step": "Passo {{current}} de {{total}}",
    "intro": "O cofre cifra as credenciais dos clientes com uma chave que só a tua palavra-passe mestra abre. Confirma-a para continuar.",
```

and after `"recoveryCodeIntro"`:

```json
    "recoveryCodeIntro": "Este é o teu código de recuperação. É a única forma de recuperares o acesso se perderes a palavra-passe mestra.",
    "recoveryCodeTitle": "Anota isto agora",
    "recoveryCodeLabel": "Código de recuperação",
    "copyCode": "Copiar código",
    "codeCopied": "Código copiado. A área de transferência limpa-se em 30 segundos.",
```

Inside `platforms`, replace `"empty"` and add two keys:

```json
    "title": "Plataformas",
    "description": "As plataformas onde o gabinete entra. As credenciais ficam em cada cliente, cifradas neste dispositivo.",
    "newTitle": "Nova plataforma",
    "empty": "Ainda não há plataformas",
    "emptyHint": "Adiciona as plataformas — Portal das Finanças, Segurança Social Direta — antes de guardares credenciais de clientes.",
```

Add a top-level `status` object after `unlock`:

```json
  "status": {
    "unlocked": "Desbloqueado · bloqueia após {{minutes}} min",
    "locked": "Bloqueado"
  },
```

- [ ] **Step 3: Add the same keys to `en/vault.json`**

Inside `setup`:

```json
    "title": "Set up the vault",
    "step": "Step {{current}} of {{total}}",
    "intro": "The vault encrypts client credentials with a key only your master password opens. Confirm it to continue.",
```

```json
    "recoveryCodeIntro": "This is your recovery code. It is the only way to regain access if you lose your master password.",
    "recoveryCodeTitle": "Write this down now",
    "recoveryCodeLabel": "Recovery code",
    "copyCode": "Copy code",
    "codeCopied": "Code copied. The clipboard clears in 30 seconds.",
```

Inside `platforms`:

```json
    "title": "Platforms",
    "description": "The platforms the practice signs in to. Credentials live on each client, encrypted on this device.",
    "newTitle": "New platform",
    "empty": "No platforms yet",
    "emptyHint": "Add the platforms — Portal das Finanças, Segurança Social Direta — before storing client credentials.",
```

After `unlock`:

```json
  "status": {
    "unlocked": "Unlocked · locks after {{minutes}} min",
    "locked": "Locked"
  },
```

- [ ] **Step 4: Verify the bundles agree and nothing broke**

```bash
pnpm --filter @ledger-hq/web i18n:check
pnpm --filter @ledger-hq/web test -- PlatformsPage
```

Expected: `i18n:check` PASS with 10 more keys than before; the existing `PlatformsPage` tests still PASS (the empty-state test matches `/ainda não há plataformas/i`, with or without the full stop).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/i18n/locales
git commit -m "feat(web): add the Stage 4 translation keys" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Move `copyAndClear` into `vault/clipboard.ts`

**Files:**
- Create: `apps/web/src/vault/clipboard.ts`
- Create: `apps/web/src/vault/clipboard.test.ts`
- Modify: `apps/web/src/vault/CredentialRow.tsx` (delete the local `CLIPBOARD_CLEAR_MS` and `copyAndClear`, import them)

**Interfaces:**
- Consumes: nothing.
- Produces: `export const CLIPBOARD_CLEAR_MS = 30_000` and `export async function copyAndClear(value: string): Promise<void>` — resolves once the value is written; **rejects** if the write fails or `navigator.clipboard` is absent; the scheduled clear never rejects. Used by `CredentialRow` and Task 7's `RecoveryCodeDisplay`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/vault/clipboard.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIPBOARD_CLEAR_MS, copyAndClear } from './clipboard'

const writeText = vi.fn()

describe('copyAndClear', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    writeText.mockReset()
    writeText.mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the value, then clears the clipboard 30 seconds later', async () => {
    await copyAndClear('secret')
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('secret')

    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS - 1)
    expect(writeText).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(writeText).toHaveBeenCalledTimes(2)
    expect(writeText).toHaveBeenLastCalledWith('')
  })

  it('swallows a clear the browser refuses', async () => {
    writeText.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'))

    await copyAndClear('secret')
    // An unhandled rejection from the timer would fail the run; reaching the
    // assertion after the clear has fired is the test.
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS)
    expect(writeText).toHaveBeenCalledTimes(2)
  })

  it('rejects when the write itself fails, so the caller can stay quiet', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    await expect(copyAndClear('secret')).rejects.toThrow('denied')
  })

  it('rejects when there is no clipboard API at all (plain HTTP)', async () => {
    Object.assign(navigator, { clipboard: undefined })
    await expect(copyAndClear('secret')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- clipboard
```

Expected: FAIL — `Failed to resolve import "./clipboard"`.

- [ ] **Step 3: Write `clipboard.ts`**

```ts
export const CLIPBOARD_CLEAR_MS = 30_000

/**
 * Copies a secret and clears the clipboard 30 seconds later — "to the
 * extent the browser permits" (spec 9.4). Rejects when the write fails or
 * the clipboard API is absent (plain HTTP has none), so a caller never
 * reports a copy that did not happen. The later clear is best-effort and
 * never rejects: by then nobody is waiting on it.
 */
export async function copyAndClear(value: string): Promise<void> {
  await navigator.clipboard.writeText(value)
  setTimeout(() => {
    navigator.clipboard.writeText('').catch(() => {})
  }, CLIPBOARD_CLEAR_MS)
}
```

- [ ] **Step 4: Point `CredentialRow` at it**

```bash
grep -n "CLIPBOARD_CLEAR_MS\|copyAndClear" apps/web/src/vault/CredentialRow.tsx
```

Delete the `const CLIPBOARD_CLEAR_MS = 30_000` line and the whole local `copyAndClear` function with its doc comment. Add, with the other local imports:

```ts
import { copyAndClear } from './clipboard'
```

If the grep showed `CLIPBOARD_CLEAR_MS` used anywhere else in the file (Stage 3 may reference it beside the Copy button), import it too — `import { CLIPBOARD_CLEAR_MS, copyAndClear } from './clipboard'` — rather than redefining it.

Every existing call site (`copyAndClear(item.password ?? '')` and whatever Stage 3 wrapped around it) stays as it is.

- [ ] **Step 5: Run the new test and the credential tests**

```bash
pnpm --filter @ledger-hq/web test -- clipboard CredentialsSection
pnpm --filter @ledger-hq/web typecheck
```

Expected: PASS. `CredentialsSection.test.tsx` passes unchanged — the move changes no behaviour.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/vault/clipboard.ts apps/web/src/vault/clipboard.test.ts apps/web/src/vault/CredentialRow.tsx
git commit -m "refactor(web): share the copy-and-clear clipboard helper" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The page header and the New platform dialog

**Files:**
- Create: `apps/web/src/vault/NewPlatformForm.tsx`
- Modify: `apps/web/src/vault/PlatformsPage.tsx`
- Modify: `apps/web/src/vault/PlatformsPage.test.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `Button`, `Dialog` (`Dialog`, `.Trigger`, `.Content`, `.Footer`, `.Close`), `Input`, `Select` from `../ui`; `createPlatform`, `listPlatforms` from `./api`; `AUTH_KIND_VALUES`, `AuthKind` from `@ledger-hq/domain`; keys from Task 2.
- Produces: `export function NewPlatformForm({ onCreated }: { onCreated: () => void })` — renders a `<form>` whose last child is a `Dialog.Footer`; must be rendered inside `Dialog.Content`. Invalidates `['platforms']` then calls `onCreated` on success. `PlatformsPage` holds `const [creating, setCreating] = useState(false)` controlling the dialog — Task 5's empty-state button calls `setCreating(true)`.

The test file gains a router wrapper now, though nothing in this task needs one: Task 6 adds a `Link`, and rewriting the harness then would churn every test.

- [ ] **Step 1: Rewrite the test file with the new harness and the dialog tests**

Replace the whole of `apps/web/src/vault/PlatformsPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { initI18n } from '../i18n'

const listPlatformsMock = vi.hoisted(() => vi.fn())
const createPlatformMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ listPlatforms: listPlatformsMock, createPlatform: createPlatformMock }))

const { PlatformsPage } = await import('./PlatformsPage')

await initI18n()
await i18next.changeLanguage('pt-PT')

const PORTAL = { id: 'p1', name: 'Portal das Finanças', url: null, authKind: 'PASSWORD' }

function renderPage(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const rootRoute = createRootRoute()
  const platformsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/vault/platforms', component: PlatformsPage })
  const setupRoute = createRoute({ getParentRoute: () => rootRoute, path: '/vault/setup', component: () => null })
  const router = createRouter({
    routeTree: rootRoute.addChildren([platformsRoute, setupRoute]),
    history: createMemoryHistory({ initialEntries: ['/vault/platforms'] }),
  })

  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

describe('PlatformsPage', () => {
  beforeEach(() => {
    listPlatformsMock.mockReset()
    createPlatformMock.mockReset()
  })

  it('is titled Vault, with the platforms as a section beneath it', async () => {
    listPlatformsMock.mockResolvedValue([PORTAL])
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Cofre' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Plataformas' })).toBeInTheDocument()
  })

  it('lists existing platforms', async () => {
    listPlatformsMock.mockResolvedValue([PORTAL])
    renderPage()
    expect(await screen.findByText('Portal das Finanças')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    listPlatformsMock.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/ainda não há plataformas/i)).toBeInTheDocument()
  })

  it('creates a platform through the dialog, then closes it and refetches', async () => {
    listPlatformsMock.mockResolvedValue([PORTAL])
    createPlatformMock.mockResolvedValue({ id: 'p2', name: 'Banco BPI Empresas', url: null, authKind: 'PASSWORD_OTP' })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /nova plataforma/i }))
    const dialog = await screen.findByRole('dialog', { name: /nova plataforma/i })

    await userEvent.type(within(dialog).getByLabelText(/^nome$/i), 'Banco BPI Empresas')
    await userEvent.type(within(dialog).getByLabelText(/url/i), 'https://bpinet.bpi.pt')
    await userEvent.selectOptions(within(dialog).getByLabelText(/tipo de autenticação/i), 'PASSWORD_OTP')
    await userEvent.click(within(dialog).getByRole('button', { name: /criar/i }))

    await waitFor(() => {
      expect(createPlatformMock).toHaveBeenCalledWith({
        name: 'Banco BPI Empresas',
        url: 'https://bpinet.bpi.pt',
        authKind: 'PASSWORD_OTP',
      })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(listPlatformsMock).toHaveBeenCalledTimes(2)
  })

  it('sends no url when the field is left empty', async () => {
    listPlatformsMock.mockResolvedValue([PORTAL])
    createPlatformMock.mockResolvedValue({ id: 'p2', name: 'X', url: null, authKind: 'PASSWORD' })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /nova plataforma/i }))
    const dialog = await screen.findByRole('dialog', { name: /nova plataforma/i })
    await userEvent.type(within(dialog).getByLabelText(/^nome$/i), 'X')
    await userEvent.click(within(dialog).getByRole('button', { name: /criar/i }))

    await waitFor(() => {
      expect(createPlatformMock).toHaveBeenCalledWith({ name: 'X', url: undefined, authKind: 'PASSWORD' })
    })
  })

  // Review Focus 4: a failed create keeps the dialog, the typed values and
  // the server's message together.
  it('keeps the dialog open with the error and the typed name when creating fails', async () => {
    listPlatformsMock.mockResolvedValue([PORTAL])
    createPlatformMock.mockRejectedValue(new ApiError('platforms.name_taken', { name: 'Portal das Finanças' }, 409))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /nova plataforma/i }))
    const dialog = await screen.findByRole('dialog', { name: /nova plataforma/i })
    await userEvent.type(within(dialog).getByLabelText(/^nome$/i), 'Portal das Finanças')
    await userEvent.click(within(dialog).getByRole('button', { name: /criar/i }))

    expect(await within(dialog).findByText('Já existe uma plataforma com o nome Portal das Finanças.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /nova plataforma/i })).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^nome$/i)).toHaveValue('Portal das Finanças')
  })

  it('closes the dialog on Cancel without creating anything', async () => {
    listPlatformsMock.mockResolvedValue([PORTAL])
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /nova plataforma/i }))
    const dialog = await screen.findByRole('dialog', { name: /nova plataforma/i })
    await userEvent.click(within(dialog).getByRole('button', { name: /cancelar/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(createPlatformMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to verify the new cases fail**

```bash
pnpm --filter @ledger-hq/web test -- PlatformsPage
```

Expected: FAIL — no level-1 heading "Cofre" (today's `<h1>` reads "Plataformas"), and no "Nova plataforma" button (today that text is an `<h2>`).

- [ ] **Step 3: Write `NewPlatformForm.tsx`**

```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AUTH_KIND_VALUES } from '@ledger-hq/domain'
import type { AuthKind } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Dialog, Input, Select } from '../ui'
import { createPlatform } from './api'

type Props = { onCreated: () => void }

/** The create form, moved out of the page. Renders inside `Dialog.Content`. */
export function NewPlatformForm({ onCreated }: Props) {
  const { t } = useTranslation(['vault', 'domain', 'common'])
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [authKind, setAuthKind] = useState<AuthKind>('PASSWORD')

  const mutation = useMutation({
    mutationFn: () => createPlatform({ name, url: url === '' ? undefined : url, authKind }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platforms'] })
      onCreated()
    },
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <Input
        label={t('vault:platforms.form.name.label')}
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        type="url"
        label={t('vault:platforms.form.url.label')}
        placeholder="https://"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
      />
      <Select
        label={t('vault:platforms.form.authKind.label')}
        value={authKind}
        onChange={(event) => setAuthKind(event.target.value as AuthKind)}
      >
        {AUTH_KIND_VALUES.map((value) => (
          <option key={value} value={value}>
            {t(`domain:authKind.${value}`)}
          </option>
        ))}
      </Select>

      <ErrorMessage error={mutation.error} />

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="primary" type="submit" isLoading={mutation.isPending}>
          {t('common:actions.create')}
        </Button>
      </Dialog.Footer>
    </form>
  )
}
```

- [ ] **Step 4: Rewrite `PlatformsPage.tsx` around the header and the dialog**

The list markup is carried over as it is today; Task 5 restyles it.

```tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Dialog, PageHeader } from '../ui'
import { listPlatforms } from './api'
import { NewPlatformForm } from './NewPlatformForm'

export function PlatformsPage() {
  const { t } = useTranslation(['vault', 'domain', 'common'])
  const [creating, setCreating] = useState(false)

  const platforms = useQuery({ queryKey: ['platforms'], queryFn: listPlatforms })

  return (
    // The Root wraps the page so the header button can be the dialog's
    // Trigger: focus returns to it when the dialog closes.
    <Dialog open={creating} onOpenChange={setCreating}>
      <div className="flex flex-col gap-8">
        <PageHeader
          title={t('common:nav.vault')}
          description={t('vault:platforms.description')}
          actions={
            <Dialog.Trigger asChild>
              <Button variant="primary">
                <Plus aria-hidden="true" className="h-4 w-4" />
                {t('vault:platforms.newTitle')}
              </Button>
            </Dialog.Trigger>
          }
        />

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{t('vault:platforms.title')}</h2>

          {platforms.isPending ? null : platforms.isError ? (
            <ErrorMessage error={platforms.error} />
          ) : platforms.data.length === 0 ? (
            <p className="text-sm text-slate-500">{t('vault:platforms.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {platforms.data.map((platform) => (
                <li key={platform.id} className="rounded border border-slate-200 bg-white p-3 text-sm">
                  <span className="font-medium">{platform.name}</span>{' '}
                  <span className="text-slate-500">{t(`domain:authKind.${platform.authKind}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Dialog.Content title={t('vault:platforms.newTitle')}>
        <NewPlatformForm onCreated={() => setCreating(false)} />
      </Dialog.Content>
    </Dialog>
  )
}
```

`Dialog.Content` unmounts when closed (Radix default), so the form's state resets each time the dialog opens — a fresh form per create, with no reset code.

- [ ] **Step 5: Run the tests and the type checker**

```bash
pnpm --filter @ledger-hq/web test -- PlatformsPage
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/vault/NewPlatformForm.tsx apps/web/src/vault/PlatformsPage.tsx apps/web/src/vault/PlatformsPage.test.tsx
git commit -m "feat(web): title the Vault page and create platforms in a dialog" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The platform list, its loading and empty states

**Files:**
- Create: `apps/web/src/vault/PlatformsPageSkeleton.tsx`
- Modify: `apps/web/src/vault/PlatformsPage.tsx`
- Modify: `apps/web/src/vault/PlatformsPage.test.tsx`

**Interfaces:**
- Consumes: `Badge`, `Card`, `DataList`, `EmptyState`, `Skeleton` from `../ui`; `PlatformAvatar` (`{ name: string }`) from `./PlatformAvatar`; `creating`/`setCreating` from Task 4.
- Produces: `export function PlatformsPageSkeleton()`; the page's list markup Task 6 keeps unchanged.

- [ ] **Step 1: Add the failing tests**

Append inside the `describe('PlatformsPage', …)` block of `PlatformsPage.test.tsx`:

```tsx
  it('shows a skeleton while loading, not a blank screen', async () => {
    // A promise that never settles: the query stays pending.
    listPlatformsMock.mockReturnValue(new Promise(() => {}))
    renderPage()

    await waitFor(() => {
      expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    })
    expect(document.querySelectorAll('[aria-hidden="true"].animate-pulse').length).toBeGreaterThan(0)
  })

  it('offers to create the first platform from the empty state', async () => {
    listPlatformsMock.mockResolvedValue([])
    renderPage()

    expect(await screen.findByText(/adiciona as plataformas/i)).toBeInTheDocument()
    // Two triggers when empty: the header's and the empty state's.
    const buttons = screen.getAllByRole('button', { name: /nova plataforma/i })
    expect(buttons).toHaveLength(2)

    await userEvent.click(buttons[1]!)
    expect(await screen.findByRole('dialog', { name: /nova plataforma/i })).toBeInTheDocument()
  })

  it('shows each platform with its URL host and authentication kind, not the full URL', async () => {
    listPlatformsMock.mockResolvedValue([
      {
        id: 'p1',
        name: 'Portal das Finanças',
        url: 'https://www.portaldasfinancas.gov.pt/at/html/index.html',
        authKind: 'PASSWORD_OTP',
      },
    ])
    renderPage()

    expect(await screen.findByText('www.portaldasfinancas.gov.pt')).toBeInTheDocument()
    expect(screen.queryByText(/index\.html/)).not.toBeInTheDocument()
    expect(screen.getByText('Palavra-passe + código de verificação')).toBeInTheDocument()
  })

  it('omits the host line for a platform with no URL', async () => {
    listPlatformsMock.mockResolvedValue([PORTAL])
    renderPage()

    await screen.findByText('Portal das Finanças')
    expect(screen.queryByText(/\.pt$/)).not.toBeInTheDocument()
  })

  // Review Focus 5: a URL stored without a scheme does not parse; show it as
  // stored rather than throwing or dropping it.
  it('shows a URL that does not parse exactly as stored', async () => {
    listPlatformsMock.mockResolvedValue([
      { id: 'p1', name: 'Segurança Social Direta', url: 'seg-social.pt', authKind: 'PASSWORD' },
    ])
    renderPage()

    expect(await screen.findByText('seg-social.pt')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- PlatformsPage
```

Expected: FAIL — no `aria-busy` region while pending (the page renders `null`), no hint text, one button when empty, no host line.

- [ ] **Step 3: Write `PlatformsPageSkeleton.tsx`**

```tsx
import { Card, Skeleton } from '../ui'

export function PlatformsPageSkeleton() {
  return (
    <Card padding="none" className="px-5" aria-busy="true">
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          className="flex min-h-[44px] items-center justify-between gap-4 border-b border-line py-3 last:border-b-0"
        >
          <span className="flex flex-1 items-center gap-3">
            <Skeleton width="2rem" height="2rem" />
            <span className="flex flex-1 flex-col gap-1.5">
              <Skeleton width="40%" height="0.875rem" />
              <Skeleton width="25%" height="0.75rem" />
            </span>
          </span>
          <Skeleton width="6rem" height="1.25rem" />
        </div>
      ))}
    </Card>
  )
}
```

- [ ] **Step 4: Replace the list in `PlatformsPage.tsx`**

Update the imports:

```tsx
import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Globe, Plus } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Badge, Button, Card, DataList, Dialog, EmptyState, PageHeader } from '../ui'
import { listPlatforms } from './api'
import { NewPlatformForm } from './NewPlatformForm'
import { PlatformAvatar } from './PlatformAvatar'
import { PlatformsPageSkeleton } from './PlatformsPageSkeleton'
```

Add above the component:

```tsx
/**
 * The host is all a reader needs to recognise a platform. A stored URL that
 * does not parse (no scheme, say) is shown as stored rather than dropped.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
```

Inside the component, add `const headingId = useId()` after the `useState` line, and replace the whole `<section>…</section>` with:

```tsx
        <section aria-labelledby={headingId} className="flex flex-col gap-4">
          <h2 id={headingId} className="text-lg font-semibold">
            {t('vault:platforms.title')}
          </h2>

          {platforms.isPending ? (
            <PlatformsPageSkeleton />
          ) : platforms.isError ? (
            <ErrorMessage error={platforms.error} />
          ) : platforms.data.length === 0 ? (
            <EmptyState
              icon={Globe}
              title={t('vault:platforms.empty')}
              description={t('vault:platforms.emptyHint')}
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  {t('vault:platforms.newTitle')}
                </Button>
              }
            />
          ) : (
            <Card padding="none" className="px-5">
              <DataList>
                {platforms.data.map((platform) => (
                  <DataList.Row
                    key={platform.id}
                    label={
                      <span className="flex items-center gap-3">
                        <PlatformAvatar name={platform.name} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{platform.name}</span>
                          {platform.url !== null && (
                            // Plain text, not a link: the row is about the
                            // record, and a stray click should not leave the app.
                            <span className="truncate text-xs text-muted">{hostOf(platform.url)}</span>
                          )}
                        </span>
                      </span>
                    }
                    value={<Badge tone="neutral">{t(`domain:authKind.${platform.authKind}`)}</Badge>}
                  />
                ))}
              </DataList>
            </Card>
          )}
        </section>
```

The empty state's button is not a `Dialog.Trigger` — Radix tracks one trigger, the header's, and focus returns there on close. That is the button that remains on screen once the first platform exists.

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- PlatformsPage
pnpm --filter @ledger-hq/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/vault/PlatformsPageSkeleton.tsx apps/web/src/vault/PlatformsPage.tsx apps/web/src/vault/PlatformsPage.test.tsx
git commit -m "feat(web): restyle the platform list with loading and empty states" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The vault status pill and the setup prompt

**Files:**
- Modify: `apps/web/src/vault/PlatformsPage.tsx`
- Modify: `apps/web/src/vault/PlatformsPage.test.tsx`

**Interfaces:**
- Consumes: `useVaultState`, `INACTIVITY_LOCK_MS`, `lockVault`/`unlockVault` (tests) from `./vault-session`; `resolveEnvelope(email): Promise<ResolvedEnvelope | null>` from `./unlock`; `useSession` from `../auth/session`; `Callout` from `../ui`; `Link` from `@tanstack/react-router`.
- Produces: nothing later tasks import. Reads the query `['vault-envelope-resolved', email]` with the same `queryFn` and `enabled` rule as `VaultUnlockGate`.

- [ ] **Step 1: Mock the session and the envelope, and add the failing tests**

In `PlatformsPage.test.tsx`, add below the existing `vi.mock('./api', …)`:

```tsx
const resolveEnvelopeMock = vi.hoisted(() => vi.fn())
vi.mock('./unlock', () => ({ resolveEnvelope: resolveEnvelopeMock }))

const useSessionMock = vi.hoisted(() => vi.fn())
vi.mock('../auth/session', () => ({ useSession: useSessionMock }))
```

Add `act` to the existing `@testing-library/react` import, so it reads:

```tsx
import { act, render, screen, waitFor, within } from '@testing-library/react'
```

and add below the `ApiError` import:

```tsx
import { lockVault, unlockVault } from './vault-session'
```

Add constants after `PORTAL`:

```tsx
const EMAIL = 'paulo@example.com'
const SET_UP = { kdfSalt: 'salt', protectedVaultKey: 'key', setUp: true, fromCache: false }
const NOT_SET_UP = { ...SET_UP, setUp: false }

// The page never uses the key itself, only the state; the stand-in
// `vault-session.test.ts` and `AppLayout.test.tsx` already use.
function unlock(): void {
  unlockVault({ type: 'secret' } as CryptoKey)
}
```

Extend the `beforeEach`:

```tsx
  beforeEach(() => {
    listPlatformsMock.mockReset()
    createPlatformMock.mockReset()
    resolveEnvelopeMock.mockReset()
    resolveEnvelopeMock.mockResolvedValue(SET_UP)
    useSessionMock.mockReturnValue({ data: { id: 'u1', email: EMAIL, locale: 'pt-PT' } })
    // vault-session is a module singleton: every test starts locked.
    lockVault()
  })
```

Append the tests:

```tsx
  it('says the vault is locked', async () => {
    listPlatformsMock.mockResolvedValue([PORTAL])
    renderPage()
    expect(await screen.findByText('Bloqueado')).toBeInTheDocument()
  })

  it('says the vault is unlocked, with the real five-minute timeout', async () => {
    unlock()
    listPlatformsMock.mockResolvedValue([PORTAL])
    renderPage()
    expect(await screen.findByText('Desbloqueado · bloqueia após 5 min')).toBeInTheDocument()
  })

  // Review Focus 2: auto-lock firing while the page is open.
  it('flips the pill to locked the moment the vault locks', async () => {
    unlock()
    listPlatformsMock.mockResolvedValue([PORTAL])
    renderPage()
    await screen.findByText('Desbloqueado · bloqueia após 5 min')

    act(() => lockVault())

    expect(await screen.findByText('Bloqueado')).toBeInTheDocument()
    expect(screen.queryByText(/desbloqueado/i)).not.toBeInTheDocument()
  })

  it('prompts to set up a vault that is not set up, linking to setup', async () => {
    resolveEnvelopeMock.mockResolvedValue(NOT_SET_UP)
    listPlatformsMock.mockResolvedValue([PORTAL])
    renderPage()

    expect(await screen.findByText('O cofre ainda não foi configurado.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /configurar agora/i })).toHaveAttribute('href', '/vault/setup')
    expect(resolveEnvelopeMock).toHaveBeenCalledWith(EMAIL)
  })

  it('does not prompt when the vault is set up', async () => {
    listPlatformsMock.mockResolvedValue([PORTAL])
    renderPage()

    await screen.findByText('Portal das Finanças')
    await waitFor(() => expect(resolveEnvelopeMock).toHaveBeenCalled())
    expect(screen.queryByText('O cofre ainda não foi configurado.')).not.toBeInTheDocument()
  })

  it('does not prompt when the vault state is unknown offline', async () => {
    resolveEnvelopeMock.mockResolvedValue(null)
    listPlatformsMock.mockResolvedValue([PORTAL])
    renderPage()

    await screen.findByText('Portal das Finanças')
    await waitFor(() => expect(resolveEnvelopeMock).toHaveBeenCalled())
    expect(screen.queryByText('O cofre ainda não foi configurado.')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /configurar agora/i })).not.toBeInTheDocument()
  })

  // Review Focus 1: a cache entry from before setup must not survive into an
  // unlocked vault, which is set up by definition.
  it('ignores a stale not-set-up envelope while the vault is unlocked', async () => {
    unlock()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['vault-envelope-resolved', EMAIL], NOT_SET_UP)
    listPlatformsMock.mockResolvedValue([PORTAL])
    renderPage(queryClient)

    await screen.findByText('Portal das Finanças')
    expect(screen.queryByText('O cofre ainda não foi configurado.')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- PlatformsPage
```

Expected: FAIL — no "Bloqueado"/"Desbloqueado" text and no setup prompt. (The stale-envelope and offline cases may already pass vacuously; they become meaningful once the callout exists.)

- [ ] **Step 3: Add the pill and the callout to `PlatformsPage.tsx`**

Final imports:

```tsx
import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Globe, Lock, LockOpen, Plus, ShieldAlert } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { useSession } from '../auth/session'
import { Badge, Button, Callout, Card, DataList, Dialog, EmptyState, PageHeader } from '../ui'
import { listPlatforms } from './api'
import { NewPlatformForm } from './NewPlatformForm'
import { PlatformAvatar } from './PlatformAvatar'
import { PlatformsPageSkeleton } from './PlatformsPageSkeleton'
import { resolveEnvelope } from './unlock'
import { INACTIVITY_LOCK_MS, useVaultState } from './vault-session'
```

Add below `hostOf`:

```tsx
const LOCK_MINUTES = INACTIVITY_LOCK_MS / 60_000

/**
 * Status about the app, not about a record — hence a pill. Driven by the
 * vault store, so it flips the moment auto-lock fires. Not a live region:
 * a lock that happens while the reader is elsewhere is explained by the
 * credentials gate when they get there.
 */
function VaultStatusPill() {
  const { t } = useTranslation('vault')
  const vaultState = useVaultState()

  return vaultState.status === 'unlocked' ? (
    <Badge shape="pill" tone="success">
      <LockOpen aria-hidden="true" className="h-3.5 w-3.5" />
      {t('status.unlocked', { minutes: LOCK_MINUTES })}
    </Badge>
  ) : (
    <Badge shape="pill" tone="neutral">
      <Lock aria-hidden="true" className="h-3.5 w-3.5" />
      {t('status.locked')}
    </Badge>
  )
}
```

Inside `PlatformsPage`, after the `platforms` query:

```tsx
  const session = useSession()
  const email = session.data?.email ?? ''
  const vaultState = useVaultState()

  // The unlock gate's own query and key, so this page adds no request shape:
  // the same cache entry answers both.
  const envelope = useQuery({
    queryKey: ['vault-envelope-resolved', email],
    queryFn: () => resolveEnvelope(email),
    enabled: email !== '' && vaultState.status === 'locked',
  })

  // An unlocked vault is set up by definition. Requiring "locked" as well
  // keeps an envelope cached before setup from prompting for a vault that
  // now exists. `null` (unknown offline) and pending both mean "say nothing".
  const notSetUp = vaultState.status === 'locked' && envelope.data?.setUp === false
```

Change the `PageHeader`'s `actions` to hold both:

```tsx
          actions={
            <>
              <VaultStatusPill />
              <Dialog.Trigger asChild>
                <Button variant="primary">
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  {t('vault:platforms.newTitle')}
                </Button>
              </Dialog.Trigger>
            </>
          }
```

and between the `PageHeader` and the `<section>` add:

```tsx
        {notSetUp && (
          <Callout
            tone="neutral"
            icon={ShieldAlert}
            action={
              <Button asChild size="sm" variant="secondary">
                <Link to="/vault/setup">{t('vault:unlock.setUpLink')}</Link>
              </Button>
            }
          >
            {t('vault:unlock.notSetUp')}
          </Callout>
        )}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- PlatformsPage VaultUnlockGate
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: PASS. `VaultUnlockGate.test.tsx` is in the run because the two components now share a cache key; it must pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/vault/PlatformsPage.tsx apps/web/src/vault/PlatformsPage.test.tsx
git commit -m "feat(web): show the vault's state and prompt for setup on the Vault page" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `RecoveryCodeDisplay`

**Files:**
- Create: `apps/web/src/vault/RecoveryCodeDisplay.tsx`
- Create: `apps/web/src/vault/RecoveryCodeDisplay.test.tsx`

**Interfaces:**
- Consumes: `copyAndClear` from `./clipboard` (Task 3); `Button`, `useToast`, `ToastProvider` from `../ui`; keys `vault:setup.recoveryCodeLabel`, `copyCode`, `codeCopied`.
- Produces: `export function RecoveryCodeDisplay({ code }: { code: string })` — `code` in the generator's canonical form (`ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z`). Renders a `<ul>` named by `recoveryCodeLabel` with one `<li>` per hyphen-separated group, and a Copy button. Must render under a `ToastProvider`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/vault/RecoveryCodeDisplay.test.tsx`:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ToastProvider } from '../ui'

const { RecoveryCodeDisplay } = await import('./RecoveryCodeDisplay')

await initI18n()
await i18next.changeLanguage('pt-PT')

const CODE = 'K7QPM-3RTXA-WN5HD-2ZBEC-Y6JLF-Q'
const writeText = vi.fn()

function renderDisplay() {
  return render(
    <I18nextProvider i18n={i18next}>
      <ToastProvider>
        <RecoveryCodeDisplay code={CODE} />
      </ToastProvider>
    </I18nextProvider>,
  )
}

describe('RecoveryCodeDisplay', () => {
  beforeEach(() => {
    writeText.mockReset()
    writeText.mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
  })

  it('renders the code as six groups, in order, in a labelled list', () => {
    renderDisplay()

    const list = screen.getByRole('list', { name: /código de recuperação/i })
    const groups = within(list).getAllByRole('listitem').map((item) => item.textContent)
    expect(groups).toEqual(['K7QPM', '3RTXA', 'WN5HD', '2ZBEC', 'Y6JLF', 'Q'])
  })

  it('does not draw the hyphens — the grid is the separator', () => {
    renderDisplay()
    expect(screen.queryByText(CODE)).not.toBeInTheDocument()
  })

  it('copies the canonical hyphenated code and confirms it', async () => {
    renderDisplay()

    await userEvent.click(screen.getByRole('button', { name: /copiar código/i }))

    expect(writeText).toHaveBeenCalledWith(CODE)
    // Radix Toast also mirrors the text into a visually hidden announcer for
    // about a second, so it can be found twice: find all, not one.
    expect(await screen.findAllByText(/código copiado/i)).not.toHaveLength(0)
  })

  // Review Focus 3: no clipboard (plain HTTP) or a denied write must not
  // produce a "copied" toast.
  it('stays quiet when the clipboard refuses the write', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    renderDisplay()

    await userEvent.click(screen.getByRole('button', { name: /copiar código/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(screen.queryAllByText(/código copiado/i)).toHaveLength(0)
    // The code is still there to copy by hand.
    expect(screen.getByRole('list', { name: /código de recuperação/i })).toBeInTheDocument()
  })

  it('stays quiet when there is no clipboard API at all', async () => {
    Object.assign(navigator, { clipboard: undefined })
    renderDisplay()

    await userEvent.click(screen.getByRole('button', { name: /copiar código/i }))

    expect(screen.queryAllByText(/código copiado/i)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- RecoveryCodeDisplay
```

Expected: FAIL — `Failed to resolve import "./RecoveryCodeDisplay"`.

- [ ] **Step 3: Write `RecoveryCodeDisplay.tsx`**

```tsx
import { useTranslation } from 'react-i18next'
import { Copy } from 'lucide-react'
import { Button, useToast } from '../ui'
import { copyAndClear } from './clipboard'

type Props = { code: string }

/**
 * The one text in the app a user copies down by hand. Each hyphen-separated
 * group is its own cell, so a group never breaks across a line and the
 * reader can keep their place. Base32 has no 0, 1, 8 or 9, so O/0 and I/1
 * cannot be confused; monospace still gives every character one shape.
 */
export function RecoveryCodeDisplay({ code }: Props) {
  const { t } = useTranslation('vault')
  const { toast } = useToast()
  const groups = code.split('-')

  async function copy(): Promise<void> {
    try {
      // A recovery code is a secret: same 30-second clear as a password.
      await copyAndClear(code)
    } catch {
      // No clipboard API (plain HTTP) or a denied write. Saying "copied"
      // would be a lie; the code stays on screen to copy by hand.
      return
    }
    toast({ title: t('setup.codeCopied'), tone: 'success' })
  }

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label={t('setup.recoveryCodeLabel')} className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {groups.map((group, index) => (
          <li
            key={`${index}-${group}`}
            className="rounded-control bg-ground px-3 py-2 text-center font-mono text-lg font-semibold tracking-widest tabular-nums"
          >
            {group}
          </li>
        ))}
      </ul>
      <Button variant="secondary" className="self-start" onClick={() => void copy()}>
        <Copy aria-hidden="true" className="h-4 w-4" />
        {t('setup.copyCode')}
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- RecoveryCodeDisplay
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/vault/RecoveryCodeDisplay.tsx apps/web/src/vault/RecoveryCodeDisplay.test.tsx
git commit -m "feat(web): lay the recovery code out for copying by hand" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `VaultSetupPage` in two steps

**Files:**
- Modify: `apps/web/src/vault/VaultSetupPage.tsx`
- Modify: `apps/web/src/vault/VaultSetupPage.test.tsx`

**Interfaces:**
- Consumes: `RecoveryCodeDisplay` (Task 7); `PageHeader`, `Card`, `Input`, `Checkbox`, `Button`, `Callout`, `ToastProvider` (test) from `../ui`; `setUpVault` from `./setup`; `useSession` from `../auth/session`; keys `vault:setup.*`.
- Produces: nothing imported later. On setup success the page removes every `['vault-envelope-resolved', …]` cache entry.

- [ ] **Step 1: Rewrite the test file**

Replace the whole of `apps/web/src/vault/VaultSetupPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ToastProvider } from '../ui'

const setUpVaultMock = vi.hoisted(() => vi.fn())
vi.mock('./setup', () => ({ setUpVault: setUpVaultMock }))

const useSessionMock = vi.hoisted(() => vi.fn())
vi.mock('../auth/session', () => ({ useSession: useSessionMock }))

const { VaultSetupPage } = await import('./VaultSetupPage')

await initI18n()
// See LoginPage.test.tsx: jsdom reports "en-US" regardless of the host,
// overriding the pt-PT fallback these assertions rely on.
await i18next.changeLanguage('pt-PT')

const EMAIL = 'paulo@example.com'
const CODE = 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z'

function renderPage(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ToastProvider>
          <VaultSetupPage />
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

async function completeStepOne(): Promise<void> {
  await userEvent.type(screen.getByLabelText(/palavra-passe mestra/i), 'a long master password')
  await userEvent.click(screen.getByRole('button', { name: /continuar/i }))
}

describe('VaultSetupPage', () => {
  beforeEach(() => {
    setUpVaultMock.mockReset()
    useSessionMock.mockReturnValue({ data: { id: 'u1', email: EMAIL, locale: 'pt-PT' } })
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  it('starts on step 1 of 2, explaining why the password is asked again', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Configura o cofre' })).toBeInTheDocument()
    expect(screen.getByText('Passo 1 de 2')).toBeInTheDocument()
    expect(screen.getByText(/só a tua palavra-passe mestra abre/i)).toBeInTheDocument()
  })

  it('passes the session email and the typed password to setup', async () => {
    setUpVaultMock.mockResolvedValue({ recoveryCode: CODE })
    renderPage()

    await completeStepOne()

    expect(setUpVaultMock).toHaveBeenCalledWith(EMAIL, 'a long master password')
  })

  it('shows the recovery code on step 2 only after a successful setup, gated by the checkbox', async () => {
    setUpVaultMock.mockResolvedValue({ recoveryCode: CODE })
    renderPage()

    await completeStepOne()

    expect(await screen.findByText('Passo 2 de 2')).toBeInTheDocument()
    expect(screen.getByText('Anota isto agora')).toBeInTheDocument()
    const groups = within(screen.getByRole('list', { name: /código de recuperação/i }))
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(groups).toEqual(['ABCDE', 'FGHIJ', 'KLMNO', 'PQRST', 'UVWXY', 'Z'])

    expect(screen.getByRole('button', { name: /continuar/i })).toBeDisabled()
    await userEvent.click(screen.getByLabelText(/anotei o código/i))
    expect(screen.getByRole('button', { name: /continuar/i })).toBeEnabled()
  })

  it('copies the code from step 2 and confirms it with a toast', async () => {
    setUpVaultMock.mockResolvedValue({ recoveryCode: CODE })
    renderPage()

    await completeStepOne()
    await userEvent.click(await screen.findByRole('button', { name: /copiar código/i }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CODE)
    // Found twice while Radix's hidden announcer holds a copy (see Task 7).
    expect(await screen.findAllByText(/código copiado/i)).not.toHaveLength(0)
  })

  it('stays on step 1 with the error when setup fails', async () => {
    setUpVaultMock.mockRejectedValue(new Error('boom'))
    renderPage()

    await completeStepOne()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Passo 1 de 2')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /código de recuperação/i })).not.toBeInTheDocument()
  })

  // Review Focus 1: the envelope query cached "not set up" before this page
  // ran. Once setup succeeds that entry is wrong, and the gate and the Vault
  // page would both read it the next time the vault locks.
  it('drops the cached envelope once the vault is set up', async () => {
    setUpVaultMock.mockResolvedValue({ recoveryCode: CODE })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['vault-envelope-resolved', EMAIL], {
      kdfSalt: 'salt',
      protectedVaultKey: 'key',
      setUp: false,
      fromCache: false,
    })
    renderPage(queryClient)

    await completeStepOne()
    await screen.findByText('Passo 2 de 2')

    expect(queryClient.getQueryData(['vault-envelope-resolved', EMAIL])).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- VaultSetupPage
```

Expected: FAIL — no "Passo 1 de 2", no grouped list, the envelope entry survives.

- [ ] **Step 3: Rewrite `VaultSetupPage.tsx`**

```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { useSession } from '../auth/session'
import { Button, Callout, Card, Checkbox, Input, PageHeader } from '../ui'
import { RecoveryCodeDisplay } from './RecoveryCodeDisplay'
import { setUpVault } from './setup'

const TOTAL_STEPS = 2

export function VaultSetupPage() {
  const { t } = useTranslation('vault')
  const session = useSession()
  const queryClient = useQueryClient()
  const [masterPassword, setMasterPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  const mutation = useMutation({
    mutationFn: () => setUpVault(session.data?.email ?? '', masterPassword),
    onSuccess: (result) => {
      setMasterPassword('')
      // The unlock gate and the Vault page share this key, and either may
      // have cached "not set up" before this page ran. Removing it (rather
      // than invalidating a query that is disabled while unlocked) means the
      // next lock fetches a fresh answer instead of showing the stale one.
      queryClient.removeQueries({ queryKey: ['vault-envelope-resolved'] })
      setRecoveryCode(result.recoveryCode)
    },
  })

  const step = recoveryCode === null ? 1 : 2

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <PageHeader title={t('setup.title')} description={t('setup.step', { current: step, total: TOTAL_STEPS })} />

      {recoveryCode === null ? (
        <Card>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              mutation.mutate()
            }}
          >
            <p className="text-sm font-normal text-muted">{t('setup.intro')}</p>
            <Input
              type="password"
              autoComplete="current-password"
              required
              label={t('setup.confirmPasswordLabel')}
              value={masterPassword}
              onChange={(event) => setMasterPassword(event.target.value)}
            />
            <ErrorMessage error={mutation.error} />
            <Button variant="primary" type="submit" isLoading={mutation.isPending} className="w-full">
              {t('setup.continueButton')}
            </Button>
          </form>
        </Card>
      ) : (
        <Card className="flex flex-col gap-6">
          <Callout tone="warning" icon={TriangleAlert} title={t('setup.recoveryCodeTitle')}>
            {t('setup.recoveryCodeIntro')}
          </Callout>
          <RecoveryCodeDisplay code={recoveryCode} />
          <Checkbox
            label={t('setup.acknowledgeLabel')}
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          {/* Reached from a link, returns there. A direct visit with no
              history stays put — a known gap, out of this stage's scope. */}
          <Button variant="primary" className="w-full" disabled={!acknowledged} onClick={() => window.history.back()}>
            {t('setup.continueButton')}
          </Button>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- VaultSetupPage RecoveryCodeDisplay
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/vault/VaultSetupPage.tsx apps/web/src/vault/VaultSetupPage.test.tsx
git commit -m "feat(web): restyle vault setup as two steps around the recovery code" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: End-to-end checks, the guidelines, and the definition of done

**Files:**
- Modify: `apps/web/e2e/vault-offline.spec.ts`
- Modify: `apps/web/e2e/shell.spec.ts`
- Modify: `docs/design/guidelines.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code depends on.

- [ ] **Step 1: Update the setup step in `vault-offline.spec.ts`**

The recovery code no longer renders its hyphens, so the dash-matching assertion would fail. Replace:

```ts
  await expect(page.getByText(/-.*-.*-.*-.*-/)).toBeVisible() // the recovery code, dash-grouped
```

with:

```ts
  // The recovery code, one cell per five-character group.
  const recoveryCode = page.getByRole('list', { name: /código de recuperação/i })
  await expect(recoveryCode).toBeVisible()
  await expect(recoveryCode.getByRole('listitem')).toHaveCount(6)
```

- [ ] **Step 2: Update the platform step in `vault-offline.spec.ts`**

Find the block that begins with the comment `// Add a platform.` and ends with `await expect(page.getByText('Portal das Finanças')).toBeVisible()`. Keep its comment about the seeded platform; replace every statement in it (four as of this plan: the `/plataformas/i` link click, the name fill, the `/criar/i` click, the final `expect`) with:

```ts
  await page.getByRole('link', { name: /cofre/i }).click()
  await page.getByRole('button', { name: /nova plataforma/i }).click()
  const platformDialog = page.getByRole('dialog', { name: /nova plataforma/i })
  await platformDialog.getByLabel(/^nome$/i).fill('Portal das Finanças')
  const createResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/platforms' && response.request().method() === 'POST',
  )
  await platformDialog.getByRole('button', { name: /^criar$/i }).click()
  // The seeded row makes this create 409 on the name, which keeps the dialog
  // open with the error; close it. Branching on the response rather than on
  // the dialog's visibility: the dialog is also visible while a successful
  // create is still refetching, and a database without the seed must pass too.
  if ((await createResponse).status() === 409) {
    await expect(platformDialog.getByRole('alert')).toBeVisible()
    await platformDialog.getByRole('button', { name: /cancelar/i }).click()
  }
  await expect(platformDialog).toBeHidden()
  await expect(page.getByText('Portal das Finanças')).toBeVisible()
```

The nav link is "Cofre" since Stage 1's rename; the old `/plataformas/i` link name no longer exists in the nav.

- [ ] **Step 3: Add the phone-width dialog check to `shell.spec.ts`**

Inside `test.describe('app shell', …)`, using the file's own `signIn` helper:

```ts
  test('opens the new platform dialog on a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)

    await page.getByRole('link', { name: /cofre/i }).click()
    await page.getByRole('button', { name: /nova plataforma/i }).click()
    await expect(page.getByRole('dialog', { name: /nova plataforma/i })).toBeVisible()
  })
```

- [ ] **Step 4: Run the end-to-end suite for these two files**

```bash
pnpm --filter @ledger-hq/web test:e2e -- vault-offline shell
```

Expected: PASS. If a step before the ones changed here fails, it belongs to an earlier stage's flow — check it against what that stage shipped before changing it.

- [ ] **Step 5: Extend `docs/design/guidelines.md`**

In §2 "Which component for which job", replace the paragraph

```markdown
**Status about the app** — a `Badge` with `shape="pill"`. Only the
connection indicator, so far.
```

with

```markdown
**Status about the app** — a `Badge` with `shape="pill"`. The connection
indicator and the Vault page's lock state (`Desbloqueado · bloqueia após 5
min` / `Bloqueado`, driven by the vault store). A pill is not a live
region: it states, it does not announce.
```

Add a new section immediately before the accessibility checklist, renumbering the checklist and every section after it. Stages 2 and 3 have already inserted sections there (Stage 2's "Forms" is §3, and Stage 3 adds its Dialogs, Tabs, Toasts and Callouts guidance), so first list the headings:

```bash
grep -n '^## ' docs/design/guidelines.md
```

The new section takes the number the accessibility checklist has now (shown below as `N`; write the digit), and the checklist and everything after it move down by one. Update any "§" cross-reference in the file that pointed at a renumbered section.

```markdown
## N. Secrets on screen

- **Never render a password.** Show a mask plus a Copy button.
- **A copied secret clears after 30 seconds**, through `copyAndClear`
  (`vault/clipboard.ts`) — passwords and the vault recovery code alike —
  and the screen says so where it happens, in the toast or beside the
  button.
- **`copyAndClear` rejects when it could not copy** (no clipboard API on
  plain HTTP, or a denied write). Catch it and say nothing: a "copied"
  toast for a copy that did not happen is worse than no toast.
- **Recovery material is displayed for transcription**: one monospace
  cell per group, in a labelled list, selectable as text. Copy is a
  convenience, never the only way out.
- **Usernames are not secrets** — copy them plainly, without the clear.
```

- [ ] **Step 6: Run the whole definition of done**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @ledger-hq/web i18n:check
pnpm --filter @ledger-hq/web test:e2e
```

Expected: all PASS. Then compare the browser at 1280×800 and 390×844 against the boards from Task 1 — the Vault page (loaded, empty, loading, not-set-up), the New platform dialog, and both setup steps. A mismatch is raised with the human partner, not silently resolved in either direction.

- [ ] **Step 7: Commit**

```bash
git add apps/web/e2e/vault-offline.spec.ts apps/web/e2e/shell.spec.ts docs/design/guidelines.md
git commit -m "test(web): cover the restyled vault screens end to end, and document secrets on screen" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
