# UI refresh, Stage 4 — design specification

**Date:** 2026-10-04
**Status:** approved
**Revised:** 2026-10-10 — folds in what writing the implementation plan
found: the `pt-PT` register (§2.6, §7), the stale not-set-up prompt
(§4.1, §4.3), a failed copy (§4.3), a failed create (§4.2), the code
cells at `text-lg` — the type scale is closed (§4.3).
**Parent:** [UI refresh design](./2026-09-19-ui-refresh-design.md) ·
[roadmap](../../design/roadmap.md) ·
[Stage 2](./2026-10-04-ui-refresh-stage-2-design.md) ·
[Stage 3](./2026-10-04-ui-refresh-stage-3-design.md) ·
[screens](https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92)

Stage 4 applies the design system to the two vault screens outside the
client detail page: the Vault page (`PlatformsPage`, reached as
**Vault** in the nav) and first-run vault setup (`VaultSetupPage`). It
adds no components — `Dialog`, `Toast`, `Callout` and the form controls
all exist by now — and is the smallest stage. Its one real design
question is the recovery code: the only text in the app a user is
expected to copy down by hand.

## 1. Scope

**Ships:**

- `vault/PlatformsPage.tsx` restyled: page header with the vault's
  state, the platform list, a "New platform" dialog, loading and empty
  states, and a prompt to set the vault up when it is not.
- `vault/VaultSetupPage.tsx` restyled as two steps, with the recovery
  code displayed for transcription and a copy action.
- `copyAndClear` moves out of `CredentialRow.tsx` into
  `vault/clipboard.ts`, shared by the credential row and the recovery
  code.
- New i18n keys (§7), both locales.

**Does not ship:**

- Vault recovery. Its screen is a mode of `LoginPage`, reached without a
  session — Stage 5 styles it with the rest of auth. (The parent spec's
  rollout line "setup/recovery" predates that being clear.)
- Editing a platform. `updatePlatform` exists in `vault/api.ts` with no
  screen; adding one is a feature, not a restyle, and nothing on the
  boards asks for it.
- Any API change. See §2.1 for what that rules out.

## 2. Decisions

1. **No credential count per platform.** The Vault boards show "18
   credentials" on each row. `GET /platforms` returns no count, and
   credentials are listed per client, not per platform. Counting from
   the device's IndexedDB cache would show a number that is wrong on any
   device that has not synced every client, which is worse than no
   number. The row shows the platform's URL host in that space instead.
   A count is a one-field API change for a later phase if it is wanted.
2. **"New platform" is a `Dialog` on desktop and mobile.** The desktop
   board draws the form as a permanent side card; the mobile board draws
   a button. Stage 3 made "creation opens a dialog from a button" the
   rule for the whole client page, and the Vault page following the same
   rule matters more than matching the desktop board. The desktop board
   is redrawn to match (§3).
3. **The vault status pill states the real timeout**, interpolated from
   `INACTIVITY_LOCK_MS` (5 minutes; exported in Stage 3). The boards'
   "locks after 15 min" was written before checking the constant.
4. **The page prompts for vault setup when the vault is not set up.**
   Today the only way to `/vault/setup` is the link inside a client's
   locked Credentials tab. The Vault page is where a user goes looking
   for it, so a `Callout` with a link appears there too. It reads the
   same `['vault-envelope-resolved', email]` query the unlock gate uses —
   no new request shape.
5. **The page title is "Vault"**, the nav label (`common:nav.vault`),
   and "Platforms" becomes the list's section heading — the rename
   Stage 1 made in the nav, finished on the page itself.
6. **`pt-PT` copy follows the bundle, not this spec's first draft.**
   Every existing `pt` string addresses the user as *tu* ("Configura o
   cofre", "Indica um nome válido") and says *bloquear/desbloquear*
   ("Bloquear cofre", "Desbloquear"). The new strings do the same: no
   formal register, no *trancar*. §7 is written that way.

## 3. Visual reference

| Artboard | What it fixes |
|---|---|
| Vault — desktop | header with status pill, platform rows |
| Vault — mobile | header pill, two-line rows, New platform button |

**Redrawn and drawn in the plan's first task:** the desktop Vault board
without the side form (a "New platform" button in the header instead),
and without credential counts; the New platform dialog; the
not-set-up callout; the empty and loading states; vault setup's two
steps, desktop and mobile — no board exists for setup today. The boards
then outrank this section where they disagree.

## 4. Screens

### 4.1 `vault/PlatformsPage.tsx`

```tsx
<div className="flex flex-col gap-8">
  <PageHeader title={t('common:nav.vault')} description={t('vault:platforms.description')}
              actions={<><VaultStatusPill /><NewPlatformButton /></>} />
  {notSetUp && <Callout …/>}
  <section aria-labelledby={headingId}>
    <h2 id={headingId}>{t('vault:platforms.title')}</h2>
    {/* error | skeleton | empty | list */}
  </section>
</div>
```

- **Header.** Title `common:nav.vault`; description
  `vault:platforms.description` (the board's sentence). Actions:
  - `VaultStatusPill` (inline in the file): `Badge shape="pill"` — the
    second app-level status pill after the connection indicator, which
    is what `pill` is reserved for. Unlocked: `tone="success"`,
    `LockOpen` icon, `vault:status.unlocked` with `{{minutes}}`. Locked:
    `tone="neutral"`, `Lock` icon, `vault:status.locked`. Driven by
    `useVaultState()`, so it flips the moment auto-lock fires.
  - `Button variant="primary"` with `Plus`, `vault:platforms.newTitle`,
    opening the dialog.
  - On mobile `PageHeader` wraps the actions below the title, as
    elsewhere; the board's top-bar pill is not adopted (the top bar is
    the shell's).
- **Not set up.** When the vault is **locked** and the envelope query
  resolves with `setUp: false`, a `Callout tone="neutral"
  icon={ShieldAlert}` above the list with `vault:unlock.notSetUp` and a
  `Button asChild size="sm"` link to `/vault/setup` labelled
  `vault:unlock.setUpLink`. While the query is pending, or when it
  resolves `null` (unknown offline), nothing renders — the page's
  subject is the platform list, and the unlock gate already explains the
  offline case where it matters.
  - The query is `useQuery({ queryKey: ['vault-envelope-resolved',
    email], queryFn: () => resolveEnvelope(email), enabled: email !== ''
    && status === 'locked' })` — the unlock gate's key, function and
    rule, so both read one cache entry.
  - An unlocked vault is set up by definition, so `setUp: false` is
    trusted only while locked. Without that, an envelope cached *before*
    setup would prompt for a vault that now exists. Setup success also
    removes the stale entry (§4.3), so the next lock fetches afresh.
- **List.** `Card padding="none" className="px-5"` with a `DataList`:
  - label: `PlatformAvatar` (Stage 3), the name (`font-medium`) and,
    under it, the URL's host in `text-xs text-muted` — the host only,
    from `new URL(url).host`, falling back to the raw string if it does
    not parse, and omitted when `url` is null. The host is plain text,
    not a link: the row is about the platform record, and an accidental
    click should not leave the app.
  - value: a `Badge tone="neutral"` with `domain:authKind.*`.
  - Rows keep the API's order.
- **Loading.** `PlatformsPageSkeleton.tsx`: four rows with an avatar
  block and two text lines. Replaces `return null`.
- **Empty.** `EmptyState icon={Globe}` with `vault:platforms.empty`
  (copy becomes a heading, §7), `vault:platforms.emptyHint`, and the New
  platform button as `action`.
- **Error.** `ErrorMessage`, unchanged.

### 4.2 New platform dialog

`Dialog` titled `vault:platforms.newTitle`, holding the form currently
inline in the page, moved to `vault/NewPlatformForm.tsx`:

- `Input` name (required), `Input type="url"` URL with placeholder
  `https://`, `Select` authentication kind over `AUTH_KIND_VALUES`.
- Footer: Cancel and `Button variant="primary" type="submit"
  isLoading` `common:actions.create`.
- On success: invalidate `['platforms']` (unchanged), close the dialog.
  On failure — most often `platforms.name_taken` (409) — the server's
  message shows in an `ErrorMessage` inside the dialog, the dialog stays
  open and the typed values stay in the fields, so the user corrects the
  name rather than retyping the form.

### 4.3 `vault/VaultSetupPage.tsx`

The page renders inside the shell (the user is signed in) at
`max-w-lg`, centred. A `PageHeader` with `vault:setup.title` and a step
caption as its description: `vault:setup.step` — "Step {{current}} of
{{total}}".

**Step 1 — confirm the master password.** A `Card`:

- `vault:setup.intro`: what the vault is and why the password is asked
  again (setup verifies it before generating anything irreversible —
  the comment in `setup.ts` says why).
- `Input type="password" autoComplete="current-password"` labelled
  `vault:setup.confirmPasswordLabel`.
- `ErrorMessage` for the mutation; `Button variant="primary"
  type="submit" isLoading` `vault:setup.continueButton`, full width.

**Step 2 — the recovery code.** A `Card`:

- `Callout tone="warning" icon={TriangleAlert}` titled
  `vault:setup.recoveryCodeTitle` with the existing
  `vault:setup.recoveryCodeIntro` — the fourth `Callout` consumer Stage 3
  anticipated.
- **The code.** The generator joins 26 base32 characters into five-
  character groups with hyphens (`ABCDE-FGHIJ-…-Z`). The display splits
  on the hyphens and renders each group as its own cell: `font-mono
  text-lg font-semibold tracking-widest tabular-nums`, `bg-ground
  rounded-control px-3 py-2`, in a grid — three columns on desktop, two
  on mobile — so a group is never broken across a line and a reader
  copying by hand can keep their place. The hyphens are not drawn; the
  grid is the separator. The grid is a `<ul>` with
  `aria-label={t('vault:setup.recoveryCodeLabel')}` and one `<li>` per
  group, so a screen reader reads six groups in order.
  - Base32 here excludes `0`, `1`, `8` and `9` (RFC 4648 alphabet),
    so the confusable pairs O/0 and I/1 cannot occur; a monospace face is
    still used so each character has one fixed shape.
- **Copy.** `Button variant="secondary"` with `Copy`,
  `vault:setup.copyCode`. It copies the code in its canonical hyphenated
  form through `copyAndClear` — the recovery code is a secret, so it
  gets the same 30-second clear as a password — and toasts
  `vault:setup.codeCopied`.
  - `copyAndClear` **rejects** when the write fails or
    `navigator.clipboard` is absent — the app is reached over Tailscale,
    possibly on plain HTTP, where there is no clipboard API. The display
    catches it and shows nothing: a "copied" toast for a copy that did
    not happen is worse than no toast, and the code is on screen and
    selectable either way. The scheduled clear never rejects; by then
    nobody is waiting on it.
- `Checkbox` `vault:setup.acknowledgeLabel` (existing copy).
- `Button variant="primary"` `vault:setup.continueButton`, full width,
  disabled until acknowledged. It still calls `window.history.back()`:
  the page is reached from a link and returns there. A direct visit
  with no history leaves the user on the page; recorded as a risk, not
  changed here.

On setup success, before showing step 2, the page calls
`queryClient.removeQueries({ queryKey: ['vault-envelope-resolved'] })`.
The entry cached `setUp: false` before setup; removing it means the next
lock fetches the real answer. It touches an existing key and adds no
request shape.

## 5. File layout

```
apps/web/src/vault/
  PlatformsPage.tsx          restyled
  PlatformsPageSkeleton.tsx  (new)
  NewPlatformForm.tsx        (new) form moved out of the page, rendered in a Dialog
  VaultSetupPage.tsx         restyled, two steps
  RecoveryCodeDisplay.tsx    (new) the grouped grid + copy button
  clipboard.ts               (new) copyAndClear + CLIPBOARD_CLEAR_MS, moved from CredentialRow
  CredentialRow.tsx          imports copyAndClear from clipboard.ts
```

## 6. Accessibility

Stage 1-3 checklists apply. Specific to this stage:

1. The status pill's text carries the state; the icon is
   `aria-hidden`. It is not a live region — a lock that happens while
   the reader is elsewhere is announced by the credentials gate when
   they return, not by a pill on another page.
2. The recovery code is readable in order by a screen reader (a list of
   groups inside a labelled region), and selectable as text — Copy is a
   convenience, not the only way out.
3. The acknowledge checkbox gates the Continue button; the button's
   disabled state is not the only cue — the checkbox's label says what
   is being confirmed.

## 7. i18n

| Key | `pt-PT` | `en-GB` |
|---|---|---|
| `vault:platforms.description` | As plataformas onde o gabinete entra. As credenciais ficam em cada cliente, cifradas neste dispositivo. | The platforms the practice signs in to. Credentials live on each client, encrypted on this device. |
| `vault:platforms.emptyHint` | Adiciona as plataformas — Portal das Finanças, Segurança Social Direta — antes de guardares credenciais de clientes. | Add the platforms — Portal das Finanças, Segurança Social Direta — before storing client credentials. |
| `vault:status.unlocked` | Desbloqueado · bloqueia após {{minutes}} min | Unlocked · locks after {{minutes}} min |
| `vault:status.locked` | Bloqueado | Locked |
| `vault:setup.step` | Passo {{current}} de {{total}} | Step {{current}} of {{total}} |
| `vault:setup.intro` | O cofre cifra as credenciais dos clientes com uma chave que só a tua palavra-passe mestra abre. Confirma-a para continuar. | The vault encrypts client credentials with a key only your master password opens. Confirm it to continue. |
| `vault:setup.recoveryCodeTitle` | Anota isto agora | Write this down now |
| `vault:setup.recoveryCodeLabel` | Código de recuperação | Recovery code |
| `vault:setup.copyCode` | Copiar código | Copy code |
| `vault:setup.codeCopied` | Código copiado. A área de transferência limpa-se em 30 segundos. | Code copied. The clipboard clears in 30 seconds. |

Copy change: `vault:platforms.empty` becomes a heading in both locales
— "Ainda não há plataformas" / "No platforms yet". No key is removed.
`pt-PT` strings use *tu* and *bloquear* (§2.6).

## 8. Testing

**Updated:**

- `vault/PlatformsPage.test.tsx` — pending renders the skeleton;
  creating a platform goes through the dialog (open, fill, submit, the
  dialog closes, the list refetches); the empty state has the New
  platform action; the pill reads Locked/Unlocked from the vault state
  and states 5 minutes; with the envelope reporting `setUp: false`, the
  setup callout links to `/vault/setup`; a row shows the URL host, not
  the full URL, and a stored URL that does not parse shows as stored; a
  create that fails with `platforms.name_taken` keeps the dialog open
  with the error and the typed name; the pill flips to Locked when
  auto-lock fires with the page open; an envelope cached with `setUp:
  false` shows no callout while the vault is unlocked.
- `vault/VaultSetupPage.test.tsx` — step caption 1 then 2; Continue
  stays disabled until the checkbox is ticked; setup success removes the
  cached `['vault-envelope-resolved']` entry.
- `vault/CredentialsSection.test.tsx` — unchanged behaviour after the
  `copyAndClear` move; it must pass as is.

**New:**

- `vault/clipboard.test.ts` — writes, then clears after 30 seconds
  (fake timers); swallows a failing clear; rejects when the write fails
  and when there is no clipboard API.
- `vault/RecoveryCodeDisplay.test.tsx` — the code renders as a labelled
  list of six groups in order, without hyphens; Copy writes the
  hyphenated code to the clipboard (mocked) and shows the toast; a
  refused write and a missing clipboard API both show no toast and
  throw nothing.

**End-to-end:** `e2e/vault-offline.spec.ts` already walks setup; its
dash-matching assertion on the code is replaced by the labelled list
with six items (hyphens are no longer drawn), and its platform step goes
through the nav's "Cofre" link and the New platform dialog. If the
create hits the seeded platform's name and stays open, the test cancels
the dialog. `e2e/shell.spec.ts` gains a 390×844 check that the New
platform button opens the dialog.

**Definition of done:** the full suite, `i18n:check` and e2e green; the
redrawn Vault boards and the new setup boards match the browser at
1280×800 and 390×844.

## 9. Risks

- **Clearing the clipboard after copying the recovery code** may
  surprise someone who copied it to paste into a password manager a
  minute later. The toast says it clears and when; the alternative —
  leaving a vault recovery secret in the clipboard indefinitely — is
  the worse failure.
- **`window.history.back()` on a direct visit** does nothing, leaving
  the user on the finished setup page. Low impact (the vault is set up
  either way) and a behaviour change, so out of scope; noted for a
  later fix.
- **No clipboard API over plain HTTP.** Copy then does nothing
  visible. The code stays on screen and selectable; a toast claiming a
  copy that did not happen would be the worse failure.
- **The envelope query on the Vault page** adds a request when the vault
  is locked. It is the gate's own cached query, keyed by email; the
  page reads it, it does not invent a new one.

## 10. Guidelines document

`docs/design/guidelines.md`: `Badge shape="pill"` gains its second
consumer (vault status) in the "status about the app" note, which also
says a pill states and does not announce; a short **Secrets on screen**
section — never render a password, mask plus Copy; copied secrets clear
after 30 seconds through `copyAndClear` and the screen says so; when the
copy fails, say nothing; recovery material is displayed grouped,
monospace, in a labelled list and selectable; usernames are not secrets
and copy without the clear.
