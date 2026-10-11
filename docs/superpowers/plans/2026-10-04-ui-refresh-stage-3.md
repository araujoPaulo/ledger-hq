# UI refresh, Stage 3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `ClientDetailPage` as a header plus five URL-backed tabs (Overview, Obligations, Billing, People, Credentials), with every form on it opening in a dialog, amounts typed in euros, and the components that make this possible — `Tabs`, `Dialog`, `Toast`, `Callout`, `MoneyInput`, and `DataList as="dl"`.

**Architecture:** Five new `ui/` components wrap Radix (`react-tabs`, `react-dialog`, `react-toast`) or compose Stage 2's `Input`. The client route gains an optional `?tab=` search param; `ClientDetailPage` reads it, renders `ClientHeader` and a controlled `Tabs`, and mounts only the active tab's section, so each tab keeps its own queries. Every feature section keeps its props and is restyled in place; each form moves into a `Dialog` opened by a button its section owns. `parseAmount`/`formatAmount` beside `formatCurrency` are the only conversions between typed text and cents.

**Tech Stack:** React 19.2, TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Tailwind CSS v4 (tokens in `apps/web/src/styles.css`), TanStack Router and Query, i18next, `class-variance-authority`, `lucide-react`, Radix (`@radix-ui/react-tabs`, `react-dialog`, `react-toast` — new; `react-dropdown-menu`, `react-slot` — existing), `@ledger-hq/domain`, `@ledger-hq/crypto`, Vitest + Testing Library (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-ui-refresh-stage-3-design.md` — read it in full before Task 1, including its **Revised** line. The control APIs it builds on are fixed by `docs/superpowers/plans/2026-10-04-ui-refresh-stage-2.md` (Tasks 3-6) and documented in `docs/design/guidelines.md` §3 "Forms". Screens: <https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92>.

## Global Constraints

- **Stage 2 must be merged first.** This plan imports `Input`/`InputProps`, `Textarea`, `Select`, `Checkbox` and `Button asChild` from `apps/web/src/ui`, `KIND_TONE` from `apps/web/src/clients/kindTone.ts`, and expects the route `/clients/$clientId/edit` and the `clients:archived` key. Task 2 Step 1 verifies them; if any is missing, stop.
- **Consume Stage 2's control surface exactly as shipped:** `label`, `hideLabel?`, `hint?`, `error?` (all typed `| undefined`, so `error={cond ? msg : undefined}` is fine), `leadingIcon?: LucideIcon` on `Input` only; `className` and `ref` land on the native control; a field error is `role="alert"`, linked by `aria-describedby`, with `aria-invalid="true"`. `MoneyInput`'s euro adornment is `leadingIcon={Euro}` from `lucide-react` — no change to `Input` (spec §5.5).
- **Later stages depend on these exports, by these names** (Stage 4 and 5 plans): `Dialog` with `.Trigger`, `.Content` (`title: string`, `description?`, `size?: 'sm' | 'md'`), `.Footer`, `.Close` (both `.Trigger` and `.Close` take `asChild`); `ToastProvider` (renders its own viewport, wraps `AppLayout`) and `useToast()` returning `{ toast }`, `toast({ title, tone?: 'neutral' | 'success' })`; `Callout` (`tone`, `icon`, `title`, `children`, `action`, `role`); all exported from `apps/web/src/ui/index.ts`. `PlatformAvatar({ name: string })` in `apps/web/src/vault/PlatformAvatar.tsx`. `INACTIVITY_LOCK_MS` exported from `apps/web/src/vault/vault-session.ts`. Do not rename any of them.
- **No API change, no route path change.** The one route change is `validateSearch` on `/clients/$clientId`, and its key is optional (spec §6.2).
- **Presentation only**, except the spec's §2 decisions: forms in dialogs, euros instead of cents, the tab in the URL, Overview's two extra queries, no paid/unpaid badges, inline attachment-delete confirmation.
- **No hardcoded user-visible strings**, `aria-label` included (`i18next/no-literal-string`, `markupOnly: true`; tests exempt). `pnpm --filter @ledger-hq/web i18n:check` compares the bundles. Remove a key in the same commit that removes its last reference.
- **`pt-PT` copy uses *tu*, and *bloquear/desbloquear* for the vault** — never the formal register, never *trancar* (spec §9). `en-GB` copy is the spec's, verbatim.
- **Tests assert Portuguese.** Every web test calls `await initI18n()` then `await i18next.changeLanguage('pt-PT')` — jsdom reports `en-US`. (`EmploymentSection.test.tsx` predates the pin and uses bilingual regexes; keep its style there.)
- **Design rules** (`docs/design/guidelines.md`): named exports only; props extend the element's own; `cva` for variants; no component sets a margin on itself; three gaps between elements (`gap-4`, `gap-6`, `gap-8`) — `gap-1`/`gap-1.5`/`gap-2` only inside a single control or a cluster of small buttons/badges; type scale `text-2xl`/`text-lg`/`text-base`/`text-sm`/`text-xs` only; weight 400 (`font-normal`) for prose only; every column of numbers `tabular-nums`; static cards are flat (`shadow-overlay` only for dialogs, toasts and menus); nothing in `ui/` imports from a feature folder; Tailwind never gets two utilities for one property on one element.
- **One dialog at a time.** A dialog never opens another; the attachment delete is confirmed inline (spec §2.6).
- **Section tests stay unit tests.** A section's test renders the section, not the page. Only `ClientDetailPage.test.tsx` renders the tabs.
- **Commit after every task** with a `feat(web):`, `refactor(web):`, `test(web):` or `docs:` prefix, each message ending with the trailer line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. The unit suite is green after every task; the e2e suite is updated in Task 21 and only run there.

## Review Focus

Five conditions the spec implies but does not test, most likely to bite first. Each has a test in the task that owns the code.

1. **A Portuguese user types a dot as the decimal mark** — `2150.50` in the payment amount. Read as grouping, it would be 21 505 000 cents (€215,050.00). Expected: not an amount — the field says so on blur and the form cannot be submitted. → Task 3 (`parseAmount`), Task 8 (`MoneyInput`), Task 17 (the payment form).
2. **An unknown or stale `?tab=`** — an old bookmark, a typo, `?tab=faturas`. Expected: the Overview tab, not a crash and not an empty strip. → Task 9 (`validateClientSearch`), Task 12 (the page).
3. **Leaving the amount field after a payment proposal exists.** The blur reformats the text; if that counted as a change it would silently retract the proposal and Confirm would vanish under the user's pointer. Expected: the proposal stays; only a changed amount or date retracts it. → Task 8, Task 17.
4. **No clipboard API** — the app is reached over Tailscale, possibly on plain HTTP, where `navigator.clipboard` is `undefined`; or the browser denies the write. Expected: Copy does nothing visible — no "copied" toast for a copy that did not happen, no uncaught error. → Task 20.
5. **A dialog's submit fails** — e.g. the new charge is refused. Expected: the dialog stays open, the typed values stay, the server's message shows inside it. → Task 17 (and the same pattern in every dialog form).

---

## File Structure

```
apps/web/
  package.json                                  Task 2: + @radix-ui/react-tabs, react-dialog, react-toast
  src/
    i18n/
      format.ts, format.test.ts                 Task 3: parseAmount, formatAmount
      locales/{pt,en}/*.json                    Task 2 (new keys); Tasks 15-17 (copy changes, key removals)
    ui/
      DataList.tsx, DataList.test.tsx           Task 4: as="dl"
      Callout.tsx, Callout.test.tsx             Task 4 (new)
      Dialog.tsx, Dialog.test.tsx               Task 5 (new)
      Tabs.tsx, Tabs.test.tsx                   Task 6 (new)
      Toast.tsx, Toast.test.tsx                 Task 7 (new)
      MoneyInput.tsx, MoneyInput.test.tsx       Task 8 (new)
      index.ts                                  Tasks 4-8
    shell/AppLayout.tsx                         Task 7: + ToastProvider
    router.tsx                                  Task 9: validateSearch on /clients/$clientId
    clients/
      clientTabs.ts, clientTabs.test.ts         Task 9 (new)
      FiscalProfileCard.tsx                     Task 10 (new)
      FiscalProfileForm.tsx, .test.tsx          Task 10: restyled, in the dialog; card tests join this file
      ClientOverviewTab.tsx, .test.tsx          Task 11 (new)
      ClientHeader.tsx                          Task 12 (new)
      ClientDetailSkeleton.tsx                  Task 12 (new)
      ClientDetailPage.tsx, .test.tsx           Task 12: header + tabs
    obligations/
      statusTone.ts                             Task 13 (new)
      ObligationRow.tsx, .test.tsx              Task 13
      ObligationsSection.tsx, .test.tsx         Task 14
      ObligationsSectionSkeleton.tsx            Task 14 (new)
      AdjustObligationForm.tsx                  Task 14
      AddAdHocObligationForm.tsx                Task 14
      ObligationAttachments.tsx, .test.tsx      Task 15
    billing/
      ReceivablesSection.tsx, .test.tsx         Task 9: client link carries ?tab=billing
      RetainerPlanCard.tsx                      Task 16 (new)
      RetainerPlanForm.tsx                      Task 16
      AgeingCard.tsx                            Task 16 (new)
      CreditCard.tsx                            Task 16 (new)
      ApplyCreditForm.tsx                       Task 16
      ledgerCards.test.tsx                      Task 16 (new)
      ClientLedgerSection.tsx, .test.tsx        Task 17
      ClientLedgerSkeleton.tsx                  Task 17 (new)
      WriteOffDialog.tsx                        Task 17 (new)
      RecordPaymentForm.tsx                     Task 17
      AddAdHocChargeForm.tsx                    Task 17
    employments/
      EmploymentSection.tsx, .test.tsx          Task 18
      AddEmploymentForm.tsx                     Task 18
    vault/
      vault-session.ts                          Task 19: export INACTIVITY_LOCK_MS
      VaultUnlockGate.tsx, .test.tsx            Task 19
      PlatformAvatar.tsx, .test.tsx             Task 20 (new)
      CredentialRow.tsx                         Task 20
      CredentialsSection.tsx, .test.tsx         Task 20
      AddCredentialForm.tsx                     Task 20
  e2e/
    setup-and-clients.spec.ts, obligations.spec.ts, billing.spec.ts,
    search-and-reporting.spec.ts, vault-offline.spec.ts      Task 21
docs/design/guidelines.md                       Task 21
docs/design/roadmap.md                          Task 21
```

`clients/clientTabs.test.ts`, `ui/Callout.test.tsx`, `vault/PlatformAvatar.test.tsx` and `billing/ledgerCards.test.tsx` are not in the spec's §11 list; each pins a new unit the spec names. The fiscal-profile card's tests live in `FiscalProfileForm.test.tsx`, the file the spec names for them.

---

### Task 1: Draw the Stage 3 boards on the canvas

**Files:** none in the repository. The canvas <https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92> is the editable source for every UI refresh screen; it is iterated in place, never replaced, and every screen exists as a desktop (1440×1024) and a mobile (390×844) frame.

**Interfaces:**
- Consumes: spec §3, §5-§7, and the `en-GB` copy of §9 (the boards use English).
- Produces: the visual reference Tasks 10-20 are checked against in Task 21. Once drawn, the boards outrank the spec's prose where they disagree; a disagreement with this plan is raised, not guessed.

- [ ] **Step 1: Read the canvas before touching it**

It can be edited in the browser between sessions, and the Stage 2, 4 and 5 plans also add boards to it. With the Artifact tool: `read` the artifact (its result carries the Design type's instructions — follow them exactly), `list` with `scope: "files"`, then `read` `project/canvas.json` and every board whose name starts with `ClientDetail`, `Credentials` or `Overview`, plus Stage 2's `ClientEdit*` and `ClientsStates*` boards (for the form-control look). Note the client-detail row's `y` and the rightmost board's `x + w` in that row.

- [ ] **Step 2: Bring the existing boards in line with the spec (spec §3)**

Edit copies under one scratch folder, at their canvas paths:

- Client detail, desktop (Billing tab) and mobile (Overview tab): header as spec §6.3 (back link "‹ Clients", 24px name, meta line with the kind tag, tax number, "Sociedade por quotas · Organizada"-style legal form and accounting, actions Edit + Archive on desktop, a "…" icon button on mobile); tab strip Overview · Obligations [2] · Billing · Employees · Credentials 🔒. Drop every "Open"/"Settled" ledger badge; a written-off charge shows a struck-through neutral "Written off" tag and its amount struck through. Ledger card header: "New charge" (secondary) and "Record payment" (primary). Side cards: Retainer plan (dl rows + "Update fee"), Ageing (bucket tag, large amount, "Oldest unpaid charge fell due on …"), Available credit.
- Credentials, desktop and mobile: the gate says "The vault locks again after 5 minutes of inactivity"; the revealed row shows the password mask, a Copy button and "Clears after 30 s" beside it, the TOTP as `123 456` with "18 s left"; the toast reads "Password copied. The clipboard clears in 30 seconds."
- The Overview loaded board (home page): obligation rows as spec §7.2.1 (name, period caption, due date, status tag only when not pending, small secondary "Mark as done").
- Every board's nav: four items (Deadlines, Clients, Vault, Reports) and the sidebar search box, as shipped.

- [ ] **Step 3: Add the new boards**

New files, each with the skeleton the type instructions give (keep the `support.js` head line exactly), real data from the existing boards, and the tokens in `apps/web/src/styles.css`. Dialogs are drawn over the dimmed page they open from (`ink` at 40%), `shadow-overlay`, 24px padding, title top-left, close × top-right, footer right-aligned (stacked full-width on mobile, primary on top).

| File (desktop / `…Mobile`) | Content |
|---|---|
| `ClientDetailOverview` | Overview tab: Details (dl rows, email and phone as links, notes as a paragraph), Fiscal profile (dl rows + flag tags with a check icon + Edit), At a glance (two tiles: "Obligations due" count in danger red, "Balance" amount) |
| `ClientDetailObligations` | Obligations tab: header with "New obligation"; the generator `Callout` (warning, refresh icon, "3 to create, 0 to retract", Apply); rows as §7.2.1 |
| `ClientDetailPeople` | People tab for a company ("Employees"): rows with the person as a link, job title caption, period, "Current" tag, "End employment"; header "Add employment" |
| `ClientDetailStates` | the page skeleton; the Obligations empty state; the Billing empty state; the Credentials not-set-up `Callout` and offline `Callout` |
| `ClientDetailDialogs1` | Fiscal profile dialog (two selects, date, four checkboxes with "A company always has open activity." under the disabled one, a danger `Callout` with one violation); Adjust obligation dialog with the Waived notes error |
| `ClientDetailDialogs2` | Record payment dialog after "Propose allocation" (amount `€ 2 150,00`, date, method, the proposal rows, excess line, Confirm); Write-off dialog (`sm`); Receipts dialog with one row in its "Delete for good" / Cancel state and the "Attach file" button |
| `ClientDetailDialogs3` | New charge, Retainer plan (create), Add employment, New credential, Change password (`sm`) |

That is fourteen boards (seven desktop, seven mobile). Add each to `canvas.json`'s `boards` (in the client-detail row, 80 px apart, continuing right of the last board in that row) and to `order`, keeping every other key as read.

- [ ] **Step 4: Publish once and report**

One Artifact publish call with `url` set to the canvas, `root` the scratch folder, `file_path` the absolute path of `project/canvas.json`, and every changed or new board in `files`. If it is refused because someone saved meanwhile, re-read the named files and redo the edit. Report the canvas link and the list of boards drawn. Do not render, screenshot or re-read to verify.

Nothing to commit.

---

### Task 2: Prerequisites, dependencies and the new translation keys

**Files:**
- Modify: `apps/web/package.json` (via `pnpm add`)
- Modify: `apps/web/src/i18n/locales/pt/{common,clients,obligations,billing,employments,vault}.json`
- Modify: `apps/web/src/i18n/locales/en/{common,clients,obligations,billing,employments,vault}.json`

**Interfaces:**
- Consumes: Stage 2's exports (verified in Step 1).
- Produces: the three Radix packages; every new key in spec §9 plus `common:notifications`. The four "(cêntimos)" label changes wait for Tasks 16-17, and the two key removals for Task 15, so no existing test breaks here.

- [ ] **Step 1: Verify the Stage 2 surface exists**

```bash
cd /Users/pauloaraujo/Projects/personal/ledger-hq
grep -nE "Input|InputProps|Select|Checkbox|Textarea" apps/web/src/ui/index.ts
grep -n "asChild" apps/web/src/ui/Button.tsx
grep -n "export const KIND_TONE" apps/web/src/clients/kindTone.ts
grep -n "clients/\$clientId/edit" apps/web/src/router.tsx
grep -n '"archived"' apps/web/src/i18n/locales/pt/clients.json
```

Expected: every line found. If any is missing, stop: Stage 2 has not merged on this branch.

- [ ] **Step 2: Install the three Radix packages and check their React peer range**

```bash
pnpm --filter @ledger-hq/web add @radix-ui/react-tabs@^1 @radix-ui/react-dialog@^1 @radix-ui/react-toast@^1
for pkg in react-tabs react-dialog react-toast; do grep -A3 '"peerDependencies"' apps/web/node_modules/@radix-ui/$pkg/package.json; done
```

Expected: each `react` peer range includes `^19.0`. If one does not, stop and raise it — there is no drop-in replacement for any of the three.

- [ ] **Step 3: Add the keys to the `pt` bundles**

`pt/common.json` — inside `"actions"`, after `"delete": "Eliminar"` (comma on the line before):

```json
    "close": "Fechar"
```

and at top level, after the `"actions"` object:

```json
  "money": { "invalid": "Indica um valor como 2150,00." },
  "notifications": "Notificações",
```

`pt/clients.json` — at top level, after `"archived"`:

```json
  "actions": "Ações do cliente",
  "details": "Dados",
  "tabs": { "overview": "Resumo", "obligations": "Obrigações", "billing": "Faturação", "credentials": "Credenciais" },
  "glance": { "title": "Num relance", "due": "Obrigações a vencer", "balance": "Saldo" },
```

and inside `"profile"`, after `"startedAt"` (comma on the line before):

```json
    "empty": "Ainda não há perfil fiscal. Sem ele, o gerador não propõe obrigações.",
    "setUp": "Preencher",
    "openActivityCompany": "Uma empresa tem sempre atividade aberta."
```

`pt/obligations.json` — inside `"section"`: `"emptyHint": "Preenche o perfil fiscal e o gerador propõe as obrigações deste cliente."`; inside `"row"`: `"overridden": "Data alterada manualmente"`; inside `"attachments"`: `"confirmDeleteAction": "Apagar definitivamente"`.

`pt/billing.json` — inside `"ledger"`: `"emptyHint": "As avenças e cobranças aparecem aqui quando são emitidas."`; inside `"writeOff"`: `"title": "Anular cobrança"`, `"badge": "Anulada"`; inside `"retainerPlan"`: `"title": "Avença"`, `"none": "Sem avença em vigor."`; and a new top-level object after `"writeOff"`:

```json
  "ageing": {
    "title": "Antiguidade",
    "oldest": "Cobrança por pagar mais antiga vence a {{date}}."
  }
```

`pt/employments.json` — top level, after `"empty"`: `"emptyHint": "Regista quem trabalha para quem, para as obrigações de pessoal."`

`pt/vault.json` — inside `"unlock"`:

```json
    "lockedTitle": "O cofre está bloqueado",
    "lockedHint": "As credenciais só são decifradas neste dispositivo. O cofre volta a bloquear após {{minutes}} minutos de inatividade.",
```

and inside `"credentials"`:

```json
    "changed": "Alterada a {{date}}",
    "copyUsername": "Copiar utilizador",
    "usernameCopied": "Utilizador copiado.",
    "passwordCopied": "Palavra-passe copiada. A área de transferência limpa-se em 30 segundos.",
    "clipboardClears": "Limpa ao fim de 30 s",
    "secondsLeft": "{{seconds}} s restantes",
```

- [ ] **Step 4: Add the same keys to the `en` bundles**

`en/common.json`: `"close": "Close"`; `"money": { "invalid": "Enter an amount such as 2,150.00." }`, `"notifications": "Notifications"`.

`en/clients.json`: `"actions": "Client actions"`, `"details": "Details"`, `"tabs": { "overview": "Overview", "obligations": "Obligations", "billing": "Billing", "credentials": "Credentials" }`, `"glance": { "title": "At a glance", "due": "Obligations due", "balance": "Balance" }`; in `"profile"`: `"empty": "No fiscal profile yet. Without one, the generator proposes no obligations."`, `"setUp": "Set up"`, `"openActivityCompany": "A company always has open activity."`.

`en/obligations.json`: `"emptyHint": "Fill in the fiscal profile and the generator proposes this client's obligations."`, `"overridden": "Date changed by hand"`, `"confirmDeleteAction": "Delete for good"`.

`en/billing.json`: `"emptyHint": "Fees and charges appear here once they are issued."`, `"title": "Write off charge"`, `"badge": "Written off"`, `"title": "Retainer plan"`, `"none": "No retainer plan in force."`, `"ageing": { "title": "Ageing", "oldest": "Oldest unpaid charge fell due on {{date}}." }` — each in the same object as its `pt` twin.

`en/employments.json`: `"emptyHint": "Record who works for whom, for the payroll obligations."`

`en/vault.json`: `"lockedTitle": "This vault is locked"`, `"lockedHint": "Credentials are decrypted on this device only. The vault locks again after {{minutes}} minutes of inactivity."`; `"changed": "Changed {{date}}"`, `"copyUsername": "Copy username"`, `"usernameCopied": "Username copied."`, `"passwordCopied": "Password copied. The clipboard clears in 30 seconds."`, `"clipboardClears": "Clears after 30 s"`, `"secondsLeft": "{{seconds}} s left"`.

- [ ] **Step 5: Verify the bundles agree and nothing broke**

```bash
pnpm --filter @ledger-hq/web i18n:check
pnpm --filter @ledger-hq/web test
pnpm --filter @ledger-hq/web typecheck
```

Expected: `i18n:check` agrees on 35 more keys than before; the suite and the type check PASS (nothing reads the new keys yet).

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/i18n/locales
git commit -m "feat(web): add the Stage 3 dependencies and translation keys" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `parseAmount` and `formatAmount`

**Files:**
- Modify: `apps/web/src/i18n/format.ts`
- Test: `apps/web/src/i18n/format.test.ts`

**Interfaces:**
- Consumes: `SupportedLocale`, `formatCurrency` (same file).
- Produces: `export function parseAmount(text: string, locale: SupportedLocale): number | null` — integer cents, or `null` when empty or not an amount; `export function formatAmount(amountCents: number, locale: SupportedLocale): string` — the locale's grouped form, two decimals, no symbol. Used by Task 8.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/i18n/format.test.ts`, change the import to

```ts
import { formatAmount, formatCurrency, formatDate, formatLongDate, formatQuarter, parseAmount } from './format'
```

and append:

```ts
describe('parseAmount', () => {
  it('reads pt-PT amounts with a comma as the decimal mark', () => {
    expect(parseAmount('2150', 'pt-PT')).toBe(215000)
    expect(parseAmount('2150,5', 'pt-PT')).toBe(215050)
    expect(parseAmount('2150,05', 'pt-PT')).toBe(215005)
    expect(parseAmount('0,99', 'pt-PT')).toBe(99)
  })

  it('accepts pt-PT thousands grouping by dot or space', () => {
    expect(parseAmount('2.150,00', 'pt-PT')).toBe(215000)
    expect(parseAmount('1.234.567,89', 'pt-PT')).toBe(123456789)
    expect(parseAmount('2 150,00', 'pt-PT')).toBe(215000)
    expect(parseAmount('2 150,00', 'pt-PT')).toBe(215000)
  })

  it('reads en-GB amounts with a dot as the decimal mark', () => {
    expect(parseAmount('2150.00', 'en-GB')).toBe(215000)
    expect(parseAmount('2,150.00', 'en-GB')).toBe(215000)
    expect(parseAmount('2,150', 'en-GB')).toBe(215000)
  })

  // Review Focus 1: a decimal typed with the other locale's mark is refused,
  // never read as an amount a hundred times larger.
  it('refuses a grouping separator that does not sit between groups of three', () => {
    expect(parseAmount('2150.50', 'pt-PT')).toBeNull()
    expect(parseAmount('1.5', 'pt-PT')).toBeNull()
    expect(parseAmount('21.50,00', 'pt-PT')).toBeNull()
    expect(parseAmount('2,15', 'en-GB')).toBeNull()
  })

  it('refuses more than two decimals', () => {
    expect(parseAmount('2.150', 'en-GB')).toBeNull()
    expect(parseAmount('10,001', 'pt-PT')).toBeNull()
  })

  it('refuses signs, letters, a second decimal mark and a bare decimal mark', () => {
    expect(parseAmount('-10', 'pt-PT')).toBeNull()
    expect(parseAmount('+10', 'pt-PT')).toBeNull()
    expect(parseAmount('10a', 'pt-PT')).toBeNull()
    expect(parseAmount('1e3', 'en-GB')).toBeNull()
    expect(parseAmount('1,2,3', 'pt-PT')).toBeNull()
    expect(parseAmount('10,', 'pt-PT')).toBeNull()
    expect(parseAmount(',50', 'pt-PT')).toBeNull()
  })

  it('treats empty and whitespace-only text as no amount', () => {
    expect(parseAmount('', 'pt-PT')).toBeNull()
    expect(parseAmount('   ', 'en-GB')).toBeNull()
  })

  it('strips surrounding whitespace and a euro sign at either end', () => {
    expect(parseAmount('  90,00 ', 'pt-PT')).toBe(9000)
    expect(parseAmount('90,00 €', 'pt-PT')).toBe(9000)
    expect(parseAmount('€90.00', 'en-GB')).toBe(9000)
  })

  it('refuses an amount past the safe integer range', () => {
    expect(parseAmount('999999999999999999', 'pt-PT')).toBeNull()
  })

  it('round-trips with formatCurrency and formatAmount', () => {
    for (const locale of ['pt-PT', 'en-GB'] as const) {
      for (const cents of [0, 1, 99, 100, 9000, 215000, 123456789]) {
        expect(parseAmount(formatCurrency(cents, locale), locale)).toBe(cents)
        expect(parseAmount(formatAmount(cents, locale), locale)).toBe(cents)
      }
    }
  })
})

describe('formatAmount', () => {
  it('groups in the locale, with two decimals and no symbol', () => {
    expect(normalise(formatAmount(215000, 'pt-PT'))).toBe('2 150,00')
    expect(formatAmount(215000, 'en-GB')).toBe('2,150.00')
    expect(formatAmount(5, 'pt-PT')).toBe('0,05')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd /Users/pauloaraujo/Projects/personal/ledger-hq
pnpm --filter @ledger-hq/web test -- format
```

Expected: FAIL — `parseAmount` and `formatAmount` are not exported.

- [ ] **Step 3: Implement them in `format.ts`**

Append after `formatCurrency`:

```ts
const SEPARATORS: Record<SupportedLocale, { decimal: string; group: string }> = {
  'pt-PT': { decimal: ',', group: '.' },
  'en-GB': { decimal: '.', group: ',' },
}

/**
 * An amount as typed, in integer cents — or `null` when the text is empty or
 * not an amount. The one place text becomes cents, beside the one place cents
 * become text (`formatCurrency`).
 *
 * The locale's decimal mark is the only decimal mark. The other separator is
 * accepted only as a thousands separator, between groups of exactly three
 * digits: in pt-PT "2.150" is 2150 euros, but "2150.50" is refused rather than
 * read as 215 050 euros. Whitespace (Intl groups with a narrow no-break space)
 * and a euro sign at either end are ignored, so an amount copied from the
 * app's own display parses. No floating point: the digits are joined and
 * parsed as one integer.
 */
export function parseAmount(text: string, locale: SupportedLocale): number | null {
  const { decimal, group } = SEPARATORS[locale]
  const compact = text.replace(/\s/g, '').replace(/^€|€$/g, '')
  if (compact === '') return null

  const parts = compact.split(decimal)
  if (parts.length > 2) return null
  const [whole = '', fraction = ''] = parts
  if (parts.length === 2 && !/^\d{1,2}$/.test(fraction)) return null

  const groups = whole.split(group)
  const isPlain = groups.length === 1 && /^\d+$/.test(whole)
  const isGrouped =
    groups.length > 1 && /^\d{1,3}$/.test(groups[0] ?? '') && groups.slice(1).every((part) => /^\d{3}$/.test(part))
  if (!isPlain && !isGrouped) return null

  const cents = Number.parseInt(`${groups.join('')}${fraction.padEnd(2, '0')}`, 10)
  return Number.isSafeInteger(cents) ? cents : null
}

/** An amount for an input field: grouped in the locale, two decimals, no symbol. */
export function formatAmount(amountCents: number, locale: SupportedLocale): string {
  // useGrouping forced for the same pt-PT ICU quirk formatCurrency documents.
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(amountCents / 100)
}
```

- [ ] **Step 4: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- format
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: PASS. If the round trip fails for `formatCurrency` in pt-PT, print `JSON.stringify(formatCurrency(215000, 'pt-PT'))` — the separator before `€` must be whitespace the `\s` class covers (U+00A0 or U+202F both are).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/i18n/format.ts apps/web/src/i18n/format.test.ts
git commit -m "feat(web): parse typed amounts into cents" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `DataList as="dl"` and `Callout`

**Files:**
- Modify: `apps/web/src/ui/DataList.tsx`
- Test: `apps/web/src/ui/DataList.test.tsx`
- Create: `apps/web/src/ui/Callout.tsx`
- Test: `apps/web/src/ui/Callout.test.tsx`
- Modify: `apps/web/src/ui/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `DataList` takes `as?: 'div' | 'dl'` (default `'div'`). With `'dl'`, each `DataList.Row` renders `<div><dt/><dd/></div>` and the label is `text-muted`. `DataList.Total` is for `'div'` lists only.
  - `export type CalloutProps = { tone?: 'neutral' | 'warning' | 'danger'; icon?: LucideIcon; title?: string; children: ReactNode; action?: ReactNode; role?: 'status' | 'alert' }` (optional members typed `| undefined`); `Callout`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('DataList', …)` in `apps/web/src/ui/DataList.test.tsx`:

```tsx
  // Spec §5.6: genuine name/value descriptions read as a description list.
  it('renders term and definition pairs as a dl', () => {
    const { container } = render(
      <DataList as="dl">
        <DataList.Row label="NIF" value="501442600" />
        <DataList.Row label="Contabilidade" value="Organizada" />
      </DataList>,
    )

    const list = container.querySelector('dl')
    expect(list).not.toBeNull()
    expect(list?.querySelectorAll(':scope > div > dt')).toHaveLength(2)
    expect(list?.querySelectorAll(':scope > div > dd')).toHaveLength(2)
    expect(screen.getByText('NIF').tagName).toBe('DT')
    expect(screen.getByText('NIF')).toHaveClass('text-muted')
    expect(screen.getByText('501442600').tagName).toBe('DD')
  })

  it('stays a plain div list by default', () => {
    const { container } = render(
      <DataList>
        <DataList.Row label="Uma linha" value="1,00 €" />
      </DataList>,
    )

    expect(container.querySelector('dl')).toBeNull()
    expect(container.querySelector('dt')).toBeNull()
  })
```

`apps/web/src/ui/Callout.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { RefreshCw } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { Callout } from './Callout'

describe('Callout', () => {
  it('renders its title, body and action', () => {
    render(
      <Callout tone="warning" icon={RefreshCw} title="Alterações por aplicar" action={<button type="button">Aplicar</button>}>
        3 a criar, 0 a retirar
      </Callout>,
    )

    expect(screen.getByText('Alterações por aplicar')).toBeInTheDocument()
    expect(screen.getByText('3 a criar, 0 a retirar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeInTheDocument()
  })

  it('hides its icon from assistive technology', () => {
    const { container } = render(<Callout icon={RefreshCw}>Texto</Callout>)

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  // The vault gate's offline message keeps the status role it carries today.
  it('carries a live-region role only when asked to', () => {
    const { rerender } = render(<Callout>Texto</Callout>)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerender(<Callout role="status">Texto</Callout>)
    expect(screen.getByRole('status')).toHaveTextContent('Texto')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- DataList Callout
```

Expected: FAIL — `as` is not a prop (type error surfaces at typecheck; at runtime no `dl` is rendered), and `./Callout` does not resolve.

- [ ] **Step 3: Rewrite `DataList.tsx`**

```tsx
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

type ListElement = 'div' | 'dl'

const ListElementContext = createContext<ListElement>('div')

/**
 * Label/value rows. `as="dl"` is for genuine name/value descriptions — a
 * client's details, a fiscal profile — and renders each row as
 * `<div><dt/><dd/></div>` (valid inside `<dl>` since HTML 5.2). Lists of
 * records (a ledger, employments) stay `div`. `Total` belongs to `div` lists.
 */
function DataListRoot({ as = 'div', children }: { as?: ListElement; children: ReactNode }) {
  const Element = as

  return (
    <ListElementContext.Provider value={as}>
      <Element className="flex flex-col">{children}</Element>
    </ListElementContext.Provider>
  )
}

const ROW_CLASS = 'flex min-h-[44px] items-center justify-between gap-4 border-b border-line py-3 last:border-b-0'

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  const element = useContext(ListElementContext)

  if (element === 'dl') {
    return (
      <div className={ROW_CLASS}>
        <dt className="shrink-0 text-sm text-muted">{label}</dt>
        <dd className="flex min-w-0 flex-1 items-center justify-end gap-3 text-right text-sm">{value}</dd>
      </div>
    )
  }

  return (
    <div className={ROW_CLASS}>
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <span className="flex shrink-0 items-center gap-3 text-sm">{value}</span>
    </div>
  )
}

function Total({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-4 border-t border-line-strong pt-3">
      <span className="text-sm font-semibold">{label}</span>
      <span className="flex shrink-0 items-center gap-3 text-sm font-semibold">{value}</span>
    </div>
  )
}

export const DataList = Object.assign(DataListRoot, { Row, Total })
```

- [ ] **Step 4: Write `Callout.tsx`**

```tsx
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cva } from 'class-variance-authority'

const callout = cva(
  'flex flex-col gap-4 rounded-surface border p-4 text-sm sm:flex-row sm:items-center sm:justify-between',
  {
    variants: {
      tone: {
        neutral: 'border-muted/20 bg-ground text-ink',
        warning: 'border-warning-700/20 bg-warning-50 text-warning-700',
        danger: 'border-danger-700/20 bg-danger-50 text-danger-700',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export type CalloutProps = {
  tone?: 'neutral' | 'warning' | 'danger' | undefined
  icon?: LucideIcon | undefined
  title?: string | undefined
  children: ReactNode
  action?: ReactNode
  /** Only for a message that must be announced when it appears, such as the vault gate's offline state. */
  role?: 'status' | 'alert' | undefined
}

/**
 * A persistent message about a section's state that is neither an error nor
 * empty — the generator preview, the vault not set up. Not a toast (it
 * stays) and not an `EmptyState` (there may be content below it).
 */
export function Callout({ tone = 'neutral', icon: Icon, title, children, action, role }: CalloutProps) {
  return (
    <div role={role} className={callout({ tone })}>
      <div className="flex min-w-0 items-start gap-2">
        {Icon !== undefined && (
          <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0${tone === 'neutral' ? ' text-muted' : ''}`} />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          {title !== undefined && <p className="font-semibold">{title}</p>}
          <div className="font-normal">{children}</div>
        </div>
      </div>
      {action !== undefined && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}
```

- [ ] **Step 5: Export `Callout`**

In `apps/web/src/ui/index.ts`, after the `Button` line:

```ts
export { Callout } from './Callout'
export type { CalloutProps } from './Callout'
```

- [ ] **Step 6: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- DataList Callout ReceivablesSection PeriodSummaryReport
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: PASS — including the existing `DataList` consumers, which are all `div` lists.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/ui/DataList.tsx apps/web/src/ui/DataList.test.tsx apps/web/src/ui/Callout.tsx apps/web/src/ui/Callout.test.tsx apps/web/src/ui/index.ts
git commit -m "feat(web): add the Callout and a description-list DataList" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `Dialog`

**Files:**
- Create: `apps/web/src/ui/Dialog.tsx`
- Test: `apps/web/src/ui/Dialog.test.tsx`
- Modify: `apps/web/src/ui/index.ts`

**Interfaces:**
- Consumes: `@radix-ui/react-dialog` (Task 2); `Button` from `./Button`; `common:actions.close` (Task 2).
- Produces: `export const Dialog` — Radix `Root` (`open`, `onOpenChange`) with `.Trigger` (Radix, `asChild`-friendly), `.Content` (`title: string`, `description?: string`, `size?: 'sm' | 'md'`, default `'md'`, plus Radix Content props; renders its own portal, overlay, title, description and close button), `.Footer` (the action row) and `.Close` (Radix, `asChild`-friendly). Every later task's dialog, and Stages 4-5, use exactly these names.

- [ ] **Step 1: Write the failing test**

`apps/web/src/ui/Dialog.test.tsx`:

```tsx
import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import { initI18n } from '../i18n'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { Input } from './Input'

await initI18n()
await i18next.changeLanguage('pt-PT')

function Harness() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button>Nova cobrança</Button>
      </Dialog.Trigger>
      <Dialog.Content title="Nova cobrança avulsa" description="Uma cobrança fora da avença.">
        <form className="flex flex-col gap-4">
          <Input label="Descrição" />
          <Dialog.Footer>
            <Dialog.Close asChild>
              <Button variant="ghost">Cancelar</Button>
            </Dialog.Close>
            <Button variant="primary" type="submit">
              Criar
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog>
  )
}

function renderHarness() {
  return render(
    <I18nextProvider i18n={i18next}>
      <Harness />
    </I18nextProvider>,
  )
}

describe('Dialog', () => {
  it('is named by its title and described by its description', async () => {
    renderHarness()
    await userEvent.click(screen.getByRole('button', { name: 'Nova cobrança' }))

    const dialog = await screen.findByRole('dialog', { name: 'Nova cobrança avulsa' })
    expect(dialog).toHaveAccessibleDescription('Uma cobrança fora da avença.')
  })

  // Spec §10.2: focus moves to the first field — not to the close button,
  // which is why Close comes after the children in the DOM.
  it('moves focus to the first field when it opens', async () => {
    renderHarness()
    await userEvent.click(screen.getByRole('button', { name: 'Nova cobrança' }))

    await waitFor(() => expect(screen.getByLabelText('Descrição')).toHaveFocus())
  })

  it('closes on Escape and returns focus to its trigger', async () => {
    renderHarness()
    const trigger = screen.getByRole('button', { name: 'Nova cobrança' })
    await userEvent.click(trigger)
    await screen.findByRole('dialog')

    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('has a labelled close button that closes it', async () => {
    renderHarness()
    await userEvent.click(screen.getByRole('button', { name: 'Nova cobrança' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Fechar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes from a Dialog.Close inside the footer', async () => {
    renderHarness()
    await userEvent.click(screen.getByRole('button', { name: 'Nova cobrança' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- Dialog
```

Expected: FAIL — `Failed to resolve import "./Dialog"`.

- [ ] **Step 3: Write `Dialog.tsx`**

```tsx
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from './Button'

type ContentProps = Omit<ComponentPropsWithoutRef<typeof RadixDialog.Content>, 'title'> & {
  /** Required: it is the dialog's accessible name, and Radix warns without one. */
  title: string
  description?: string | undefined
  size?: 'sm' | 'md' | undefined
}

/**
 * The dialog itself: portal, overlay, title, optional description, then the
 * caller's content. The close button comes after the content in the DOM —
 * positioned top-right, but last in tab order — so Radix's autofocus on open
 * lands on the first field rather than on Close.
 */
function Content({ title, description, size = 'md', className, children, ...rest }: ContentProps) {
  const { t } = useTranslation('common')

  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
      <RadixDialog.Content
        {...rest}
        // Without a description Radix expects to be told there is none.
        {...(description === undefined ? { 'aria-describedby': undefined } : {})}
        className={`fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-6 overflow-y-auto rounded-surface bg-surface p-6 shadow-overlay ${size === 'sm' ? 'max-w-sm' : 'max-w-lg'}${className === undefined ? '' : ` ${className}`}`}
      >
        <div className="flex flex-col gap-1.5 pr-10">
          <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
          {description !== undefined && (
            <RadixDialog.Description className="text-sm font-normal text-muted">{description}</RadixDialog.Description>
          )}
        </div>
        {children}
        <RadixDialog.Close asChild>
          <Button variant="ghost" size="icon" aria-label={t('actions.close')} className="absolute right-4 top-4">
            <X aria-hidden="true" className="h-4 w-4" />
          </Button>
        </RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}

/**
 * The action row at the foot of a dialog's form: right-aligned; on a phone the
 * buttons stretch and stack. Put Cancel first and the primary action last —
 * the stack reverses, so the primary action is on top on a phone.
 */
function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-4 pt-2 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
      {children}
    </div>
  )
}

export const Dialog = Object.assign(RadixDialog.Root, {
  Trigger: RadixDialog.Trigger,
  Content,
  Footer,
  Close: RadixDialog.Close,
})
```

- [ ] **Step 4: Export it**

In `apps/web/src/ui/index.ts`, after the `DataList` line:

```ts
export { Dialog } from './Dialog'
```

- [ ] **Step 5: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- Dialog
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 5 `Dialog` tests PASS. If the focus test finds Close focused, the close button has been moved before `{children}` — move it back.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/Dialog.tsx apps/web/src/ui/Dialog.test.tsx apps/web/src/ui/index.ts
git commit -m "feat(web): add the Dialog component" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `Tabs`

**Files:**
- Create: `apps/web/src/ui/Tabs.tsx`
- Test: `apps/web/src/ui/Tabs.test.tsx`
- Modify: `apps/web/src/ui/index.ts`

**Interfaces:**
- Consumes: `@radix-ui/react-tabs` (Task 2).
- Produces: `export const Tabs` — Radix `Root` with `.List` (a horizontally scrolling strip), `.Trigger` (children may include a `Badge` or an icon after the label) and `.Content` (unstyled; unmounted while inactive, so its queries do not run). Task 12 uses it controlled.

- [ ] **Step 1: Write the failing test**

`apps/web/src/ui/Tabs.test.tsx`:

```tsx
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Tabs } from './Tabs'

function Harness() {
  const [value, setValue] = useState('overview')

  return (
    <Tabs value={value} onValueChange={setValue}>
      <Tabs.List aria-label="Cliente">
        <Tabs.Trigger value="overview">Resumo</Tabs.Trigger>
        <Tabs.Trigger value="billing">Faturação</Tabs.Trigger>
        <Tabs.Trigger value="credentials">Credenciais</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="overview">Painel de resumo</Tabs.Content>
      <Tabs.Content value="billing">Painel de faturação</Tabs.Content>
      <Tabs.Content value="credentials">Painel de credenciais</Tabs.Content>
    </Tabs>
  )
}

describe('Tabs', () => {
  // Spec §5.1: an inactive panel is unmounted, so its queries do not run.
  it('mounts only the active panel', () => {
    render(<Harness />)

    expect(screen.getByText('Painel de resumo')).toBeInTheDocument()
    expect(screen.queryByText('Painel de faturação')).not.toBeInTheDocument()
    expect(screen.queryByText('Painel de credenciais')).not.toBeInTheDocument()
  })

  it('moves between tabs with the arrow keys, and Home/End jump', async () => {
    render(<Harness />)

    await userEvent.tab()
    expect(screen.getByRole('tab', { name: 'Resumo' })).toHaveFocus()

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Faturação' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Painel de faturação')).toBeInTheDocument()
    expect(screen.queryByText('Painel de resumo')).not.toBeInTheDocument()

    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Credenciais' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Resumo' })).toHaveAttribute('aria-selected', 'true')
  })

  it('labels each panel by its tab', () => {
    render(<Harness />)

    expect(screen.getByRole('tabpanel', { name: 'Resumo' })).toHaveTextContent('Painel de resumo')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- Tabs
```

Expected: FAIL — `Failed to resolve import "./Tabs"`.

- [ ] **Step 3: Write `Tabs.tsx`**

```tsx
import type { ComponentPropsWithoutRef } from 'react'
import * as RadixTabs from '@radix-ui/react-tabs'

/** Scrolls sideways rather than wrapping, with the scrollbar hidden — a phone's tab strip. */
function List({ className, ...rest }: ComponentPropsWithoutRef<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      {...rest}
      className={`flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden${className === undefined ? '' : ` ${className}`}`}
    />
  )
}

/**
 * The active tab's 2px rule overlaps the strip's 1px border (`-mb-px`), so the
 * two read as one line. A `Badge` or icon after the label is part of the
 * tab's accessible name.
 */
function Trigger({ className, ...rest }: ComponentPropsWithoutRef<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      {...rest}
      className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3.5 py-2.5 text-sm font-medium text-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent-600 data-[state=active]:border-accent-600 data-[state=active]:font-semibold data-[state=active]:text-accent-700${className === undefined ? '' : ` ${className}`}`}
    />
  )
}

/** `Content` is Radix's, unstyled: without `forceMount`, an inactive panel is unmounted. */
export const Tabs = Object.assign(RadixTabs.Root, { List, Trigger, Content: RadixTabs.Content })
```

- [ ] **Step 4: Export it**

In `apps/web/src/ui/index.ts`, after the `Skeleton` line:

```ts
export { Tabs } from './Tabs'
```

- [ ] **Step 5: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- Tabs
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 3 `Tabs` tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/Tabs.tsx apps/web/src/ui/Tabs.test.tsx apps/web/src/ui/index.ts
git commit -m "feat(web): add the Tabs component" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `Toast`, mounted in the shell

**Files:**
- Create: `apps/web/src/ui/Toast.tsx`
- Test: `apps/web/src/ui/Toast.test.tsx`
- Modify: `apps/web/src/ui/index.ts`
- Modify: `apps/web/src/shell/AppLayout.tsx`

**Interfaces:**
- Consumes: `@radix-ui/react-toast` (Task 2); `common:notifications` (Task 2).
- Produces: `export function ToastProvider({ children }: { children: ReactNode })` — renders its own viewport; `export function useToast(): { toast: (input: { title: string; tone?: 'neutral' | 'success' }) => void }` — throws outside the provider. `AppLayout` wraps the shell in `ToastProvider`. Task 20 and Stage 4 call `useToast`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/ui/Toast.test.tsx`:

```tsx
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ToastProvider, useToast } from './Toast'

await initI18n()
await i18next.changeLanguage('pt-PT')

function CopyButton() {
  const { toast } = useToast()
  return (
    <button type="button" onClick={() => toast({ title: 'Palavra-passe copiada.', tone: 'success' })}>
      Copiar
    </button>
  )
}

function renderWithProvider() {
  return render(
    <I18nextProvider i18n={i18next}>
      <ToastProvider>
        <CopyButton />
      </ToastProvider>
    </I18nextProvider>,
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Toast', () => {
  it('shows the title in the translated notifications region', async () => {
    renderWithProvider()

    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }))

    const region = screen.getByRole('region', { name: /notificações/i })
    expect(await within(region).findByText('Palavra-passe copiada.')).toBeInTheDocument()
  })

  it('disappears after four seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProvider()

    await user.click(screen.getByRole('button', { name: 'Copiar' }))
    const region = screen.getByRole('region', { name: /notificações/i })
    expect(await within(region).findByText('Palavra-passe copiada.')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_500)
    })

    expect(within(region).queryByText('Palavra-passe copiada.')).not.toBeInTheDocument()
  })

  // A missing provider is a wiring bug, not something to swallow silently.
  it('refuses to work outside its provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<CopyButton />)).toThrow(/ToastProvider/)

    consoleError.mockRestore()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- Toast
```

Expected: FAIL — `Failed to resolve import "./Toast"`.

- [ ] **Step 3: Write `Toast.tsx`**

```tsx
import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import * as RadixToast from '@radix-ui/react-toast'
import { useTranslation } from 'react-i18next'
import { Check, Info } from 'lucide-react'

type ToastTone = 'neutral' | 'success'
type ToastInput = { title: string; tone?: ToastTone | undefined }
type ToastItem = { id: number; title: string; tone: ToastTone }

const TOAST_DURATION_MS = 4_000
/** Enough to see a burst of copies acknowledged, not enough to build a column. */
const MAX_VISIBLE = 3

const ToastContext = createContext<((input: ToastInput) => void) | null>(null)

let nextId = 0

/**
 * Mounted once, in `AppLayout`. Only for confirming something with no other
 * visible result — a copy to the clipboard. A dialog that closes and a list
 * that updates is its own confirmation.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common')
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((input: ToastInput) => {
    nextId += 1
    const item: ToastItem = { id: nextId, title: input.title, tone: input.tone ?? 'neutral' }
    setToasts((current) => [...current.slice(-(MAX_VISIBLE - 1)), item])
  }, [])

  function remove(id: number) {
    setToasts((current) => current.filter((item) => item.id !== id))
  }

  return (
    // "background" makes Radix announce politely, not assertively.
    <RadixToast.Provider duration={TOAST_DURATION_MS} label={t('notifications')} swipeDirection="right">
      <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>

      {toasts.map((item) => {
        const Icon = item.tone === 'success' ? Check : Info
        return (
          <RadixToast.Root
            key={item.id}
            type="background"
            onOpenChange={(open) => {
              if (!open) remove(item.id)
            }}
            className="flex items-center gap-2 rounded-surface bg-ink px-4 py-3 text-sm text-white shadow-overlay"
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            <RadixToast.Title>{item.title}</RadixToast.Title>
          </RadixToast.Root>
        )
      })}

      {/* Bottom-centre on a phone, lifted above the tab bar; bottom-right from md. */}
      <RadixToast.Viewport
        label={`${t('notifications')} ({hotkey})`}
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 outline-none md:bottom-6 md:left-auto md:right-6 md:translate-x-0"
      />
    </RadixToast.Provider>
  )
}

export function useToast(): { toast: (input: ToastInput) => void } {
  const toast = useContext(ToastContext)
  if (toast === null) throw new Error('useToast must be used inside ToastProvider')
  return { toast }
}
```

- [ ] **Step 4: Export it, and mount it in `AppLayout`**

In `apps/web/src/ui/index.ts`, after the `Textarea` lines:

```ts
export { ToastProvider, useToast } from './Toast'
```

In `apps/web/src/shell/AppLayout.tsx`, add `import { ToastProvider } from '../ui'` and wrap the returned `<div className="flex min-h-dvh …">…</div>` in `<ToastProvider>…</ToastProvider>`. Nothing else in the file changes.

- [ ] **Step 5: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- Toast AppLayout
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 3 `Toast` tests PASS; `AppLayout.test.tsx` passes unchanged. If the four-second test is flaky, it is the fake-timer wiring — keep `shouldAdvanceTime` and the `userEvent.setup({ advanceTimers })` pair together; do not raise the duration in the component.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/Toast.tsx apps/web/src/ui/Toast.test.tsx apps/web/src/ui/index.ts apps/web/src/shell/AppLayout.tsx
git commit -m "feat(web): add toasts and mount their provider in the shell" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `MoneyInput`

**Files:**
- Create: `apps/web/src/ui/MoneyInput.tsx`
- Test: `apps/web/src/ui/MoneyInput.test.tsx`
- Modify: `apps/web/src/ui/index.ts`

**Interfaces:**
- Consumes: `Input`, `InputProps` (Stage 2); `parseAmount`, `formatAmount`, `SupportedLocale` from `../i18n/format` (Task 3); `common:money.invalid` (Task 2).
- Produces: `export type MoneyInputProps = Omit<InputProps, 'type' | 'value' | 'defaultValue' | 'onChange' | 'inputMode' | 'leadingIcon'> & { defaultCents?: number | null; onValueChange: (cents: number | null) => void }`; `MoneyInput`. Calls `onValueChange` on every change with cents or `null`; never on blur. Tasks 16-17 use it.

- [ ] **Step 1: Write the failing test**

`apps/web/src/ui/MoneyInput.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { MoneyInput } from './MoneyInput'

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderInput(props: { defaultCents?: number | null } = {}) {
  const onValueChange = vi.fn()
  render(
    <I18nextProvider i18n={i18next}>
      <MoneyInput label="Valor" onValueChange={onValueChange} {...props} />
    </I18nextProvider>,
  )
  return { onValueChange, input: screen.getByRole('textbox', { name: 'Valor' }) }
}

/** Intl groups pt-PT amounts with a narrow no-break space. */
function shown(value: string): string {
  return value.replace(/\s/g, ' ')
}

afterEach(async () => {
  await i18next.changeLanguage('pt-PT')
})

describe('MoneyInput', () => {
  it('emits cents while typing euros', async () => {
    const { onValueChange, input } = renderInput()

    await userEvent.type(input, '2150,5')

    expect(onValueChange).toHaveBeenLastCalledWith(215050)
  })

  it('emits null for text that is not an amount', async () => {
    const { onValueChange, input } = renderInput()

    await userEvent.type(input, '12abc')

    expect(onValueChange).toHaveBeenLastCalledWith(null)
  })

  // Review Focus 1.
  it('treats a dot typed as a decimal mark in pt-PT as not an amount', async () => {
    const { onValueChange, input } = renderInput()

    await userEvent.type(input, '2150.50')
    await userEvent.tab()

    expect(onValueChange).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('alert')).toHaveTextContent('Indica um valor como 2150,00.')
  })

  // Spec §10.5: announced only on blur, never mid-typing.
  it('shows the format error only after blur, and hides it again while typing', async () => {
    const { input } = renderInput()

    await userEvent.type(input, '12,345')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await userEvent.tab()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')

    await userEvent.type(input, '{Backspace}')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('rewrites a valid amount in the grouped form on blur', async () => {
    const { input } = renderInput()

    await userEvent.type(input, '2150')
    await userEvent.tab()

    expect(shown((input as HTMLInputElement).value)).toBe('2 150,00')
  })

  // Review Focus 3: the blur rewrite is not a change of value.
  it('does not report a value on blur', async () => {
    const { onValueChange, input } = renderInput()

    await userEvent.type(input, '90')
    const callsBeforeBlur = onValueChange.mock.calls.length
    await userEvent.tab()

    expect(onValueChange).toHaveBeenCalledTimes(callsBeforeBlur)
  })

  it('pre-fills defaultCents in the active locale', async () => {
    renderInput({ defaultCents: 215000 })
    expect(shown((screen.getByRole('textbox', { name: 'Valor' }) as HTMLInputElement).value)).toBe('2 150,00')
  })

  it('pre-fills in en-GB notation when that is the active locale', async () => {
    await i18next.changeLanguage('en-GB')
    renderInput({ defaultCents: 215000 })

    expect(screen.getByRole('textbox', { name: 'Valor' })).toHaveValue('2,150.00')
  })

  it('asks the phone for a decimal keypad and draws the euro sign', () => {
    const { input } = renderInput()

    expect(input).toHaveAttribute('inputmode', 'decimal')
    expect(input).toHaveClass('pl-9')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- MoneyInput
```

Expected: FAIL — `Failed to resolve import "./MoneyInput"`.

- [ ] **Step 3: Write `MoneyInput.tsx`**

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Euro } from 'lucide-react'
import { formatAmount, parseAmount } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Input } from './Input'
import type { InputProps } from './Input'

export type MoneyInputProps = Omit<
  InputProps,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'inputMode' | 'leadingIcon'
> & {
  defaultCents?: number | null | undefined
  /** Cents on every change, or `null` when the text is empty or not an amount. */
  onValueChange: (cents: number | null) => void
}

/**
 * An amount typed in euros, in the locale's own notation; the parent only
 * ever sees integer cents. The text is the component's state — a form resets
 * it by changing the `key`, or by unmounting it with its dialog.
 *
 * Whether an amount must be positive is the form's rule, not this
 * component's.
 */
export function MoneyInput({ defaultCents, onValueChange, onBlur, error, ...rest }: MoneyInputProps) {
  const { t, i18n } = useTranslation('common')
  const locale = i18n.language as SupportedLocale

  const [text, setText] = useState(() =>
    defaultCents === null || defaultCents === undefined ? '' : formatAmount(defaultCents, locale),
  )
  // Typing is never interrupted: the format error waits for the field to be left.
  const [blurred, setBlurred] = useState(false)

  const cents = parseAmount(text, locale)
  const formatError = blurred && text.trim() !== '' && cents === null ? t('money.invalid') : undefined

  return (
    <Input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      leadingIcon={Euro}
      value={text}
      error={error ?? formatError}
      onChange={(event) => {
        setText(event.target.value)
        setBlurred(false)
        onValueChange(parseAmount(event.target.value, locale))
      }}
      onBlur={(event) => {
        setBlurred(true)
        // A rewrite of the same amount, not a new value — so no onValueChange,
        // or leaving the field would retract a payment proposal.
        if (cents !== null) setText(formatAmount(cents, locale))
        onBlur?.(event)
      }}
    />
  )
}
```

- [ ] **Step 4: Export it**

In `apps/web/src/ui/index.ts`, after the `Money` line:

```ts
export { MoneyInput } from './MoneyInput'
export type { MoneyInputProps } from './MoneyInput'
```

- [ ] **Step 5: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- MoneyInput
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 9 `MoneyInput` tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/MoneyInput.tsx apps/web/src/ui/MoneyInput.test.tsx apps/web/src/ui/index.ts
git commit -m "feat(web): add MoneyInput for amounts typed in euros" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The tab search param, and the receivables link that uses it

**Files:**
- Create: `apps/web/src/clients/clientTabs.ts`
- Test: `apps/web/src/clients/clientTabs.test.ts`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/billing/ReceivablesSection.tsx`
- Test: `apps/web/src/billing/ReceivablesSection.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const CLIENT_TABS = ['overview', 'obligations', 'billing', 'people', 'credentials'] as const`; `export type ClientTab`; `export function isClientTab(value: unknown): value is ClientTab`; `export function validateClientSearch(search: Record<string, unknown>): { tab?: ClientTab }`. The route `/clients/$clientId` validates with it, so `useSearch({ from: '/clients/$clientId' })` is `{ tab?: ClientTab }` and a `Link` may pass `search={{ tab }}` (Tasks 11, 12). Links that pass no search keep type-checking because the key is optional.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/clients/clientTabs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CLIENT_TABS, isClientTab, validateClientSearch } from './clientTabs'

describe('validateClientSearch', () => {
  it('keeps a known tab', () => {
    for (const tab of CLIENT_TABS) expect(validateClientSearch({ tab })).toEqual({ tab })
  })

  // Review Focus 2: an old bookmark or a typo lands on Overview.
  it('drops an unknown, empty or non-string tab', () => {
    expect(validateClientSearch({ tab: 'faturas' })).toEqual({})
    expect(validateClientSearch({ tab: '' })).toEqual({})
    expect(validateClientSearch({ tab: 3 })).toEqual({})
    expect(validateClientSearch({})).toEqual({})
  })

  it('ignores other search params', () => {
    expect(validateClientSearch({ tab: 'billing', q: 'x' })).toEqual({ tab: 'billing' })
  })
})

describe('isClientTab', () => {
  it('accepts exactly the five tabs', () => {
    expect(CLIENT_TABS.filter(isClientTab)).toHaveLength(5)
    expect(isClientTab('Overview')).toBe(false)
    expect(isClientTab(undefined)).toBe(false)
  })
})
```

In `apps/web/src/billing/ReceivablesSection.test.tsx`, in `'links each client name to its detail page'`, change the expected `href` to `'/clients/c1?tab=billing'`, and rename the test `'links each client name to its Billing tab'`.

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- clientTabs ReceivablesSection
```

Expected: FAIL — `./clientTabs` does not resolve; the receivables link has no `?tab=billing`.

- [ ] **Step 3: Write `clientTabs.ts`**

```ts
/** The client page's tabs, in strip order. */
export const CLIENT_TABS = ['overview', 'obligations', 'billing', 'people', 'credentials'] as const

export type ClientTab = (typeof CLIENT_TABS)[number]

export function isClientTab(value: unknown): value is ClientTab {
  return typeof value === 'string' && (CLIENT_TABS as readonly string[]).includes(value)
}

/**
 * The client route's search params: an optional `tab`, where absent or
 * unknown means Overview. Optional rather than defaulted, because a required
 * key would make every typed `Link` to a client pass `search` — and most do
 * not care which tab opens.
 */
export function validateClientSearch(search: Record<string, unknown>): { tab?: ClientTab } {
  return isClientTab(search.tab) ? { tab: search.tab } : {}
}
```

- [ ] **Step 4: Validate the route's search**

In `apps/web/src/router.tsx`, add `import { validateClientSearch } from './clients/clientTabs'`, and give `clientDetailRoute` the validator:

```tsx
const clientDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients/$clientId',
  // The active tab lives in the URL, so a reload keeps it and a receivable
  // can link straight to its client's Billing tab.
  validateSearch: validateClientSearch,
  component: ClientDetailPage,
})
```

- [ ] **Step 5: Link receivables to the Billing tab**

In `apps/web/src/billing/ReceivablesSection.tsx`, the row's `Link` becomes:

```tsx
                  // Following a receivable to its client's billing is the
                  // only thing anyone does from this list.
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: row.clientId }}
                    search={{ tab: 'billing' }}
                    className="font-medium"
                  >
                    {row.clientName}
                  </Link>
```

- [ ] **Step 6: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- clientTabs ReceivablesSection
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: PASS, and no type error at any existing `Link`/`navigate` to `/clients/$clientId` (they pass no `search`, which the optional key allows). If the type check demands `search` at those call sites, the validator's return type has lost its `?` — restore it rather than adding `search={{}}` everywhere.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/clients/clientTabs.ts apps/web/src/clients/clientTabs.test.ts apps/web/src/router.tsx apps/web/src/billing/ReceivablesSection.tsx apps/web/src/billing/ReceivablesSection.test.tsx
git commit -m "feat(web): carry the client tab in the URL" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: The fiscal profile card, and its form in a dialog

**Files:**
- Create: `apps/web/src/clients/FiscalProfileCard.tsx`
- Modify: `apps/web/src/clients/FiscalProfileForm.tsx`
- Test: `apps/web/src/clients/FiscalProfileForm.test.tsx`

**Interfaces:**
- Consumes: `Badge`, `Button`, `Callout`, `Card`, `Checkbox`, `DataList`, `Dialog`, `Input`, `Select`, `Skeleton` from `../ui`; `getFiscalProfile`, `putFiscalProfile`, `FiscalProfileResponse` from `./api`; `ApiError` from `../api/client`; keys from Task 2.
- Produces: `export function FiscalProfileCard({ clientId, kind }: { clientId: string; kind: ClientKind })` — owns the `['fiscal-profile', clientId]` query (moved out of `ClientDetailPage`) and the dialog. `FiscalProfileForm` gains `onSaved: () => void` and must render inside `Dialog.Content` (its footer is a `Dialog.Footer` with a `Dialog.Close`). Task 11 renders the card.

- [ ] **Step 1: Rewrite the test file**

`apps/web/src/clients/FiscalProfileForm.test.tsx`:

```tsx
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ApiError } from '../api/client'
import { Dialog } from '../ui'

const getFiscalProfile = vi.hoisted(() => vi.fn())
const putFiscalProfile = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getFiscalProfile, putFiscalProfile }))

const { FiscalProfileForm } = await import('./FiscalProfileForm')
const { FiscalProfileCard } = await import('./FiscalProfileCard')

await initI18n()
// Same pin as the other clients/* tests: jsdom reports navigator.language
// as "en-US", overriding the pt-PT fallback these assertions rely on.
await i18next.changeLanguage('pt-PT')

function wrap(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>{children}</I18nextProvider>
    </QueryClientProvider>
  )
}

// The form's footer is a Dialog.Footer with a Dialog.Close, so it only ever
// renders inside a dialog — the tests put it in one.
function renderForm(kind: 'COMPANY' | 'INDIVIDUAL') {
  const onSaved = vi.fn()
  render(
    wrap(
      <Dialog open>
        <Dialog.Content title="Perfil fiscal">
          <FiscalProfileForm clientId="1" kind={kind} initial={null} onSaved={onSaved} />
        </Dialog.Content>
      </Dialog>,
    ),
  )
  return { onSaved }
}

const profile = {
  clientId: '1',
  updatedAt: '2026-09-01T10:00:00.000Z',
  hasOpenActivity: true,
  vatRegime: 'MONTHLY',
  incomeTax: 'CIT',
  hasEmployees: true,
  hasWithholding: false,
  isVatCashBasis: false,
  startedAt: '2024-01-01',
}

beforeEach(() => {
  getFiscalProfile.mockReset()
  putFiscalProfile.mockReset()
})

describe('FiscalProfileForm', () => {
  it('hides hasEmployees entirely for an individual', () => {
    renderForm('INDIVIDUAL')
    expect(screen.queryByLabelText(/tem empregados/i)).not.toBeInTheDocument()
  })

  // Disabled is right here: it applies, and cannot change (spec §7.1).
  it('forces hasOpenActivity on and read-only for a company, and says why', () => {
    renderForm('COMPANY')
    const openActivity = screen.getByRole('checkbox', { name: /atividade aberta/i })
    expect(openActivity).toBeChecked()
    expect(openActivity).toBeDisabled()
    expect(openActivity).toHaveAccessibleDescription(/uma empresa tem sempre atividade aberta/i)
    expect(screen.getByLabelText(/tem empregados/i)).toBeInTheDocument()
  })

  it('shows a live violation in a callout and disables submit, without calling the API', async () => {
    renderForm('INDIVIDUAL')

    const saveButton = screen.getByRole('button', { name: /^guardar$/i })
    expect(saveButton).toBeEnabled()

    await userEvent.selectOptions(screen.getByLabelText(/imposto sobre o rendimento/i), 'CIT')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /imposto sobre o rendimento não corresponde ao tipo de cliente/i,
    )
    expect(saveButton).toBeDisabled()

    await userEvent.click(saveButton)
    expect(putFiscalProfile).not.toHaveBeenCalled()
  })

  it('saves once the violation is cleared, then reports it saved', async () => {
    putFiscalProfile.mockResolvedValue({})
    const { onSaved } = renderForm('INDIVIDUAL')

    await userEvent.selectOptions(screen.getByLabelText(/imposto sobre o rendimento/i), 'CIT')
    await userEvent.selectOptions(screen.getByLabelText(/imposto sobre o rendimento/i), 'PIT_CATEGORY_B')
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    await vi.waitFor(() => {
      expect(putFiscalProfile).toHaveBeenCalledWith('1', expect.objectContaining({ incomeTax: 'PIT_CATEGORY_B' }))
    })
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })
})

describe('FiscalProfileCard', () => {
  function renderCard(kind: 'COMPANY' | 'INDIVIDUAL' = 'COMPANY') {
    render(wrap(<FiscalProfileCard clientId="1" kind={kind} />))
  }

  it('reads a loaded profile, with a badge for each flag that is on and none for those off', async () => {
    getFiscalProfile.mockResolvedValue(profile)
    renderCard()

    expect(await screen.findByText('Mensal')).toBeInTheDocument()
    expect(screen.getByText('IRC')).toBeInTheDocument()
    expect(screen.getByText('01/01/2024')).toBeInTheDocument()
    expect(screen.getByText('Atividade aberta')).toBeInTheDocument()
    expect(screen.getByText('Tem empregados')).toBeInTheDocument()
    expect(screen.queryByText('Faz retenções na fonte')).not.toBeInTheDocument()
  })

  it('opens the form, filled from the profile, from the Edit button', async () => {
    getFiscalProfile.mockResolvedValue(profile)
    renderCard()

    await userEvent.click(await screen.findByRole('button', { name: /^editar$/i }))

    const dialog = await screen.findByRole('dialog', { name: 'Perfil fiscal' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByLabelText(/regime de iva/i)).toHaveValue('MONTHLY')
  })

  it('offers to set up a missing profile, with the kind defaults', async () => {
    getFiscalProfile.mockRejectedValue(new ApiError('common.not_found', {}, 404))
    renderCard('COMPANY')

    expect(await screen.findByText(/ainda não há perfil fiscal/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^preencher$/i }))

    expect(await screen.findByRole('checkbox', { name: /atividade aberta/i })).toBeChecked()
  })

  // The guard against overwriting a profile that merely failed to load.
  it('shows the error and offers no form when the profile fails to load', async () => {
    getFiscalProfile.mockRejectedValue(new ApiError('common.internal_error', {}, 500))
    renderCard()

    expect(await screen.findByText(/ocorreu um erro no servidor/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^editar$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^preencher$/i })).not.toBeInTheDocument()
  })

  it('closes the dialog once the profile is saved', async () => {
    getFiscalProfile.mockResolvedValue(profile)
    putFiscalProfile.mockResolvedValue(profile)
    renderCard()

    await userEvent.click(await screen.findByRole('button', { name: /^editar$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^guardar$/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- FiscalProfileForm
```

Expected: FAIL — `./FiscalProfileCard` does not resolve; the form has no `onSaved` and no callout.

- [ ] **Step 3: Rewrite `FiscalProfileForm.tsx`**

Keep `defaultsFor` and `toInput` exactly as they are. Replace the imports, `Props` and the component:

```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CircleAlert } from 'lucide-react'
import { INCOME_TAX_VALUES, VAT_REGIME_VALUES, checkFiscalProfileConsistency } from '@ledger-hq/domain'
import type { ClientKind, FiscalProfileInput, IncomeTax, VatRegime } from '@ledger-hq/domain'
import { ErrorMessage, translateErrorCode } from '../shell/ErrorMessage'
import { Button, Callout, Checkbox, Dialog, Input, Select } from '../ui'
import { putFiscalProfile } from './api'
import type { FiscalProfileResponse } from './api'

type Props = {
  clientId: string
  kind: ClientKind
  /** `null` when no profile has been saved yet: GET returns 404 in that case. */
  initial: FiscalProfileResponse | null
  /** Called once the save and its invalidations are done; the card closes its dialog. */
  onSaved: () => void
}
```

```tsx
/** Renders inside `Dialog.Content`: its footer is a `Dialog.Footer` with a `Dialog.Close`. */
export function FiscalProfileForm({ clientId, kind, initial, onSaved }: Props) {
  const { t } = useTranslation(['clients', 'domain', 'common'])
  const { t: tError } = useTranslation('errors')
  const queryClient = useQueryClient()

  const [values, setValues] = useState<FiscalProfileInput>(() =>
    initial ? toInput(initial) : defaultsFor(kind),
  )

  // Recomputed on every render, so it reflects the latest edit and never
  // reimplements a rule this function itself already owns.
  const violations = checkFiscalProfileConsistency(kind, values)

  const mutation = useMutation({
    mutationFn: (input: FiscalProfileInput) => putFiscalProfile(clientId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fiscal-profile', clientId] })
      await queryClient.invalidateQueries({ queryKey: ['obligations-preview', clientId] })
      onSaved()
    },
  })

  function update<K extends keyof FiscalProfileInput>(key: K, value: FiscalProfileInput[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (violations.length > 0) return
        mutation.mutate(values)
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label={t('clients:profile.vatRegime')}
          value={values.vatRegime}
          onChange={(event) => update('vatRegime', event.target.value as VatRegime)}
        >
          {VAT_REGIME_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`domain:vatRegime.${value}`)}
            </option>
          ))}
        </Select>
        <Select
          label={t('clients:profile.incomeTax')}
          value={values.incomeTax}
          onChange={(event) => update('incomeTax', event.target.value as IncomeTax)}
        >
          {INCOME_TAX_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`domain:incomeTax.${value}`)}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          label={t('clients:profile.startedAt')}
          value={values.startedAt}
          onChange={(event) => update('startedAt', event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-4">
        {/* Disabled is right here: for a company the flag applies and cannot change. */}
        <Checkbox
          label={t('clients:profile.hasOpenActivity')}
          checked={values.hasOpenActivity}
          disabled={kind === 'COMPANY'}
          description={kind === 'COMPANY' ? t('clients:profile.openActivityCompany') : undefined}
          onChange={(event) => update('hasOpenActivity', event.target.checked)}
        />
        {kind === 'COMPANY' && (
          <Checkbox
            label={t('clients:profile.hasEmployees')}
            checked={values.hasEmployees}
            onChange={(event) => update('hasEmployees', event.target.checked)}
          />
        )}
        <Checkbox
          label={t('clients:profile.hasWithholding')}
          checked={values.hasWithholding}
          onChange={(event) => update('hasWithholding', event.target.checked)}
        />
        <Checkbox
          label={t('clients:profile.isVatCashBasis')}
          checked={values.isVatCashBasis}
          onChange={(event) => update('isVatCashBasis', event.target.checked)}
        />
      </div>

      {violations.length > 0 && (
        <Callout tone="danger" icon={CircleAlert} role="alert">
          <ul className="flex flex-col gap-1">
            {violations.map((code) => (
              <li key={code}>{translateErrorCode(tError, code)}</li>
            ))}
          </ul>
        </Callout>
      )}

      <ErrorMessage error={mutation.error} />

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="primary" type="submit" isLoading={mutation.isPending} disabled={violations.length > 0}>
          {t('common:actions.save')}
        </Button>
      </Dialog.Footer>
    </form>
  )
}
```

- [ ] **Step 4: Write `FiscalProfileCard.tsx`**

```tsx
import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { ClientKind } from '@ledger-hq/domain'
import { ApiError } from '../api/client'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Badge, Button, Card, DataList, Dialog, Skeleton } from '../ui'
import { getFiscalProfile } from './api'
import type { FiscalProfileResponse } from './api'
import { FiscalProfileForm } from './FiscalProfileForm'

/** A list of four "No"s says nothing: only the flags that are on are shown. */
const FLAGS = ['hasOpenActivity', 'hasEmployees', 'hasWithholding', 'isVatCashBasis'] as const

function ProfileView({ profile }: { profile: FiscalProfileResponse }) {
  const { t, i18n } = useTranslation(['clients', 'domain'])
  const on = FLAGS.filter((flag) => profile[flag])

  return (
    <div className="flex flex-col gap-4">
      <DataList as="dl">
        <DataList.Row label={t('clients:profile.vatRegime')} value={t(`domain:vatRegime.${profile.vatRegime}`)} />
        <DataList.Row label={t('clients:profile.incomeTax')} value={t(`domain:incomeTax.${profile.incomeTax}`)} />
        <DataList.Row
          label={t('clients:profile.startedAt')}
          value={<span className="tabular-nums">{formatDate(profile.startedAt, i18n.language as SupportedLocale)}</span>}
        />
      </DataList>
      {on.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {on.map((flag) => (
            <Badge key={flag} tone="neutral">
              <Check aria-hidden="true" className="h-3.5 w-3.5" />
              {t(`clients:profile.${flag}`)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

export function FiscalProfileCard({ clientId, kind }: { clientId: string; kind: ClientKind }) {
  const { t } = useTranslation(['clients', 'common'])
  const titleId = useId()
  const [editing, setEditing] = useState(false)

  // A brand-new client has no fiscal profile row yet: GET returns
  // common.not_found in that case, which is an expected state here, not a
  // failure to retry.
  const profile = useQuery({
    queryKey: ['fiscal-profile', clientId],
    queryFn: () => getFiscalProfile(clientId),
    retry: false,
  })

  const missing = profile.error instanceof ApiError && profile.error.code === 'common.not_found'
  // A genuine fetch failure (a real 500, or the browser going offline) must
  // not be indistinguishable from "no profile exists yet": offering the form
  // with defaults in that case would let a submit silently overwrite a
  // profile that merely failed to load, with no ErrorMessage in sight.
  const failed = profile.isError && !missing
  const canEdit = !profile.isPending && !failed

  return (
    <section aria-labelledby={titleId}>
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-base font-semibold">
            {t('clients:profile.title')}
          </h2>
          {canEdit && (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              {missing ? t('clients:profile.setUp') : t('common:actions.edit')}
            </Button>
          )}
        </div>

        {profile.isPending ? (
          <div className="flex flex-col gap-3" aria-busy="true">
            <Skeleton height="0.875rem" />
            <Skeleton height="0.875rem" />
            <Skeleton width="60%" height="0.875rem" />
          </div>
        ) : failed ? (
          <ErrorMessage error={profile.error} />
        ) : missing || profile.data === undefined ? (
          <p className="text-sm font-normal text-muted">{t('clients:profile.empty')}</p>
        ) : (
          <ProfileView profile={profile.data} />
        )}
      </Card>

      <Dialog open={editing} onOpenChange={setEditing}>
        {canEdit && (
          <Dialog.Content title={t('clients:profile.title')}>
            <FiscalProfileForm
              clientId={clientId}
              kind={kind}
              initial={profile.data ?? null}
              onSaved={() => setEditing(false)}
            />
          </Dialog.Content>
        )}
      </Dialog>
    </section>
  )
}
```

- [ ] **Step 5: Put the card on today's client page**

`ClientDetailPage` is rebuilt in Task 12; until then it must keep compiling and its tests passing. In `ClientDetailPage.tsx`, replace the `fiscalProfile` query, `profileMissing`, `profileFailed` and the whole `{fiscalProfile.isPending ? null : … }` block with `<FiscalProfileCard clientId={clientId} kind={record.kind} />`, and remove the now-unused `ApiError`, `getFiscalProfile` and `FiscalProfileForm` imports. In `ClientDetailPage.test.tsx`, delete the two fiscal-profile tests (`'shows an error message, not the fiscal profile form, …'` and `'renders the fiscal profile form with defaults …'`) — this task's `FiscalProfileCard` tests replace them — and add `putFiscalProfile: vi.fn()` to its `vi.mock('./api', …)`.

- [ ] **Step 6: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- FiscalProfileForm ClientDetailPage
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 9 tests PASS in `FiscalProfileForm.test.tsx`; `ClientDetailPage.test.tsx`'s remaining tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/clients/FiscalProfileCard.tsx apps/web/src/clients/FiscalProfileForm.tsx apps/web/src/clients/FiscalProfileForm.test.tsx apps/web/src/clients/ClientDetailPage.tsx apps/web/src/clients/ClientDetailPage.test.tsx
git commit -m "feat(web): show the fiscal profile as a card that edits in a dialog" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: The Overview tab

**Files:**
- Create: `apps/web/src/clients/ClientOverviewTab.tsx`
- Test: `apps/web/src/clients/ClientOverviewTab.test.tsx`

**Interfaces:**
- Consumes: `FiscalProfileCard` (Task 10); `Card`, `DataList`, `Money`, `Skeleton` from `../ui`; `listObligations` from `../obligations/api`; `getClientLedger` from `../billing/api`; `groupByUrgency` from `@ledger-hq/domain`; `ClientResponse` from `./api`; `validateClientSearch` (test only, Task 9).
- Produces: `export function ClientOverviewTab({ client }: { client: ClientResponse })` — Details, the fiscal profile card and At a glance. It fetches `['obligations', clientId]` and `['client-ledger', clientId]` — the keys the Obligations and Billing tabs read (spec §2.4). Task 12 renders it.

- [ ] **Step 1: Write the failing test**

`apps/web/src/clients/ClientOverviewTab.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ApiError } from '../api/client'
import { validateClientSearch } from './clientTabs'

const getFiscalProfile = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getFiscalProfile, putFiscalProfile: vi.fn() }))
const listObligations = vi.hoisted(() => vi.fn())
vi.mock('../obligations/api', () => ({ listObligations }))
const getClientLedger = vi.hoisted(() => vi.fn())
vi.mock('../billing/api', () => ({ getClientLedger }))

const { ClientOverviewTab } = await import('./ClientOverviewTab')

await initI18n()
await i18next.changeLanguage('pt-PT')

const client = {
  id: '1',
  kind: 'COMPANY' as const,
  name: 'Padaria Central, Lda.',
  taxId: '501442600',
  accounting: 'ORGANIZED' as const,
  legalForm: 'LDA',
  email: 'geral@padaria.pt',
  phone: '912 345 678',
  notes: 'Fecha às segundas.',
  socialSecurityNo: null,
  dateOfBirth: null,
  archivedAt: null,
}

function isoDaysFromToday(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function obligation(id: string, dueDate: string) {
  return {
    id,
    clientId: '1',
    clientName: client.name,
    definitionCode: 'VAT_MONTHLY_RETURN',
    definitionName: 'Declaração periódica de IVA',
    authority: 'TAX',
    periodLabel: '2026-01',
    dueDate,
    dueDateOverridden: false,
    status: 'PENDING',
    completedAt: null,
    reference: null,
    amountCents: null,
    notes: null,
  }
}

// The tiles are Links to the client route with a tab, so the tab renders
// under a router whose detail route validates its search like the app's.
function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/clients/$clientId',
    validateSearch: validateClientSearch,
    component: () => <ClientOverviewTab client={client} />,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/clients/1'] }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getFiscalProfile.mockReset().mockRejectedValue(new ApiError('common.not_found', {}, 404))
  listObligations.mockReset().mockResolvedValue([])
  getClientLedger.mockReset().mockResolvedValue({ entries: [], balanceCents: 0, availableCreditCents: 0 })
})

describe('ClientOverviewTab', () => {
  it('lists the details that are set, with email and phone as links', async () => {
    renderTab()

    expect(await screen.findByRole('heading', { name: 'Dados' })).toBeInTheDocument()
    expect(screen.getByText('501442600')).toBeInTheDocument()
    expect(screen.getByText('Sociedade por quotas')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'geral@padaria.pt' })).toHaveAttribute('href', 'mailto:geral@padaria.pt')
    expect(screen.getByRole('link', { name: '912 345 678' })).toHaveAttribute('href', 'tel:912345678')
    expect(screen.queryByText('NISS')).not.toBeInTheDocument()
  })

  it('shows notes as prose under the details, not as a row', async () => {
    renderTab()

    const notes = await screen.findByText('Fecha às segundas.')
    expect(notes.tagName).toBe('P')
  })

  it('counts overdue and this-week obligations, in danger red when any are overdue', async () => {
    listObligations.mockResolvedValue([
      obligation('o1', isoDaysFromToday(-3)),
      obligation('o2', isoDaysFromToday(2)),
      obligation('o3', isoDaysFromToday(60)),
    ])
    renderTab()

    const tile = await screen.findByRole('link', { name: /obrigações a vencer\s*2/i })
    expect(tile).toHaveAttribute('href', '/clients/1?tab=obligations')
    expect(screen.getByText('2')).toHaveClass('text-danger-700')
  })

  it('shows the balance, linked to the Billing tab', async () => {
    getClientLedger.mockResolvedValue({ entries: [], balanceCents: 15000, availableCreditCents: 0 })
    renderTab()

    const tile = await screen.findByRole('link', { name: /saldo\s*150,00/i })
    expect(tile).toHaveAttribute('href', '/clients/1?tab=billing')
  })

  it('renders the fiscal profile card', async () => {
    renderTab()

    expect(await screen.findByRole('heading', { name: 'Perfil fiscal' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- ClientOverviewTab
```

Expected: FAIL — `Failed to resolve import "./ClientOverviewTab"`.

- [ ] **Step 3: Write `ClientOverviewTab.tsx`**

```tsx
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { groupByUrgency } from '@ledger-hq/domain'
import type { LegalForm } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Card, DataList, Money, Skeleton } from '../ui'
import { getClientLedger } from '../billing/api'
import { listObligations } from '../obligations/api'
import type { ClientResponse } from './api'
import type { ClientTab } from './clientTabs'
import { FiscalProfileCard } from './FiscalProfileCard'

const LINK_CLASS = 'text-accent-700 hover:underline'

function DetailsCard({ client }: { client: ClientResponse }) {
  const { t, i18n } = useTranslation(['clients', 'domain'])
  const locale = i18n.language as SupportedLocale

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">{t('clients:details')}</h2>
      <DataList as="dl">
        <DataList.Row label={t('clients:form.taxId.label')} value={<span className="tabular-nums">{client.taxId}</span>} />
        <DataList.Row label={t('clients:form.accounting.label')} value={t(`domain:accounting.${client.accounting}`)} />
        {client.legalForm !== null && (
          // Guaranteed non-null only for a COMPANY, whose legalForm is always one of LEGAL_FORM_VALUES.
          <DataList.Row
            label={t('clients:form.legalForm.label')}
            value={t(`domain:legalForm.${client.legalForm as LegalForm}`)}
          />
        )}
        {client.socialSecurityNo !== null && (
          <DataList.Row
            label={t('clients:form.socialSecurityNo.label')}
            value={<span className="tabular-nums">{client.socialSecurityNo}</span>}
          />
        )}
        {client.dateOfBirth !== null && (
          <DataList.Row
            label={t('clients:form.dateOfBirth.label')}
            value={<span className="tabular-nums">{formatDate(client.dateOfBirth, locale)}</span>}
          />
        )}
        {client.email !== null && (
          <DataList.Row
            label={t('clients:form.email.label')}
            value={
              <a href={`mailto:${client.email}`} className={`truncate ${LINK_CLASS}`}>
                {client.email}
              </a>
            }
          />
        )}
        {client.phone !== null && (
          <DataList.Row
            label={t('clients:form.phone.label')}
            value={
              <a href={`tel:${client.phone.replace(/\s/g, '')}`} className={`tabular-nums ${LINK_CLASS}`}>
                {client.phone}
              </a>
            }
          />
        )}
      </DataList>
      {/* A paragraph does not fit a value slot. */}
      {client.notes !== null && <p className="whitespace-pre-line text-sm font-normal">{client.notes}</p>}
    </Card>
  )
}

function GlanceTile({
  clientId,
  tab,
  label,
  children,
}: {
  clientId: string
  tab: ClientTab
  label: string
  children: ReactNode
}) {
  return (
    <Link
      to="/clients/$clientId"
      params={{ clientId }}
      search={{ tab }}
      className="flex min-h-[44px] flex-col gap-1.5 rounded-surface border border-line p-4 hover:bg-ground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
    >
      <span className="text-sm font-medium text-muted">{label}</span>
      {children}
    </Link>
  )
}

function AtAGlance({ clientId }: { clientId: string }) {
  const { t } = useTranslation('clients')

  // The same keys the Obligations and Billing tabs read (spec §2.4), so
  // switching to either is instant.
  const obligations = useQuery({ queryKey: ['obligations', clientId], queryFn: () => listObligations({ clientId }) })
  const ledger = useQuery({ queryKey: ['client-ledger', clientId], queryFn: () => getClientLedger(clientId) })

  const groups = obligations.data === undefined ? undefined : groupByUrgency(obligations.data, new Date())
  const due = groups === undefined ? 0 : groups.overdue.length + groups.thisWeek.length
  const anyOverdue = groups !== undefined && groups.overdue.length > 0

  return (
    <Card className="flex flex-col gap-4 self-start">
      <h2 className="text-base font-semibold">{t('glance.title')}</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
        <GlanceTile clientId={clientId} tab="obligations" label={t('glance.due')}>
          {obligations.isPending ? (
            <Skeleton width="2.5rem" height="2rem" />
          ) : obligations.isError ? (
            <ErrorMessage error={obligations.error} />
          ) : (
            <span className={`text-2xl font-semibold tabular-nums${anyOverdue ? ' text-danger-700' : ''}`}>{due}</span>
          )}
        </GlanceTile>
        <GlanceTile clientId={clientId} tab="billing" label={t('glance.balance')}>
          {ledger.isPending ? (
            <Skeleton width="6rem" height="2rem" />
          ) : ledger.isError ? (
            <ErrorMessage error={ledger.error} />
          ) : (
            <Money cents={ledger.data.balanceCents} size="lg" />
          )}
        </GlanceTile>
      </div>
    </Card>
  )
}

/** Details and fiscal profile on the left, At a glance on the right; one column on a phone. */
export function ClientOverviewTab({ client }: { client: ClientResponse }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <DetailsCard client={client} />
        <FiscalProfileCard clientId={client.id} kind={client.kind} />
      </div>
      <AtAGlance clientId={client.id} />
    </div>
  )
}
```

- [ ] **Step 4: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- ClientOverviewTab
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 5 `ClientOverviewTab` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/clients/ClientOverviewTab.tsx apps/web/src/clients/ClientOverviewTab.test.tsx
git commit -m "feat(web): add the client Overview tab" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: The page — header, tabs, skeleton

**Files:**
- Create: `apps/web/src/clients/ClientHeader.tsx`
- Create: `apps/web/src/clients/ClientDetailSkeleton.tsx`
- Modify: `apps/web/src/clients/ClientDetailPage.tsx` (rewrite)
- Test: `apps/web/src/clients/ClientDetailPage.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `Tabs` (Task 6), `Badge`, `Button`, `Card`, `DropdownMenu`, `Skeleton` from `../ui`; `ClientOverviewTab` (Task 11); `isClientTab`, `validateClientSearch` (Task 9); `KIND_TONE` (Stage 2); `useVaultState` from `../vault/vault-session`; the four feature sections, unchanged props.
- Produces: `ClientDetailPage` (same export) — `ClientHeader`, then a controlled `Tabs` whose value is `?tab=` (Overview when absent), switching with `replace: true`. `export function ClientHeader({ client }: { client: ClientResponse })`; `export function ClientDetailSkeleton()`.

- [ ] **Step 1: Rewrite the test file**

`apps/web/src/clients/ClientDetailPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ApiError } from '../api/client'
import { validateClientSearch } from './clientTabs'

const getClient = vi.hoisted(() => vi.fn())
const archiveClient = vi.hoisted(() => vi.fn())
const getFiscalProfile = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({
  getClient,
  archiveClient,
  restoreClient: vi.fn(),
  getFiscalProfile,
  putFiscalProfile: vi.fn(),
}))
const listObligations = vi.hoisted(() => vi.fn())
vi.mock('../obligations/api', () => ({
  listObligations,
  generateObligations: vi.fn().mockResolvedValue({ toCreate: [], toRetract: [] }),
  patchObligation: vi.fn(),
  createAdHocObligation: vi.fn(),
}))
vi.mock('../billing/api', () => ({
  getClientLedger: vi.fn().mockResolvedValue({ entries: [], balanceCents: 0, availableCreditCents: 0 }),
  getCurrentRetainerPlan: vi.fn().mockResolvedValue(null),
  getReceivables: vi.fn().mockResolvedValue([]),
  proposeAllocation: vi.fn(),
  recordPayment: vi.fn(),
  applyCredit: vi.fn(),
  writeOffCharge: vi.fn(),
  createAdHocCharge: vi.fn(),
  createRetainerPlan: vi.fn(),
  renewRetainerPlan: vi.fn(),
}))

const { ClientDetailPage } = await import('./ClientDetailPage')

await initI18n()
// Same pin as the rest of clients/*.test.tsx: jsdom reports
// navigator.language as "en-US", overriding the pt-PT fallback these
// Portuguese-only assertions rely on.
await i18next.changeLanguage('pt-PT')

const company = {
  id: '1',
  kind: 'COMPANY',
  name: 'Padaria Central, Lda.',
  taxId: '501442600',
  accounting: 'ORGANIZED',
  legalForm: 'LDA',
  email: null,
  phone: null,
  notes: null,
  socialSecurityNo: null,
  dateOfBirth: null,
  archivedAt: null,
}

// `useParams`/`useSearch` need the real parameterised route, validating its
// search exactly as the app's router does.
function renderPage(url = '/clients/1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/clients/$clientId',
    validateSearch: validateClientSearch,
    component: ClientDetailPage,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([detailRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  })

  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return { router }
}

beforeEach(() => {
  getClient.mockReset().mockResolvedValue(company)
  archiveClient.mockReset()
  getFiscalProfile.mockReset().mockRejectedValue(new ApiError('common.not_found', {}, 404))
  listObligations.mockReset().mockResolvedValue([])
})

describe('ClientDetailPage', () => {
  it('shows a skeleton while the client loads', async () => {
    getClient.mockReturnValue(new Promise(() => {}))
    renderPage()

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull())
  })

  it('opens on Overview', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Padaria Central, Lda.' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Resumo' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('heading', { name: 'Dados' })).toBeInTheDocument()
  })

  it('opens the tab the URL names', async () => {
    renderPage('/clients/1?tab=billing')

    expect(await screen.findByRole('tab', { name: 'Faturação' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('region', { name: /^faturação$/i })).toBeInTheDocument()
  })

  // Review Focus 2.
  it('falls back to Overview for an unknown tab', async () => {
    renderPage('/clients/1?tab=faturas')

    expect(await screen.findByRole('tab', { name: 'Resumo' })).toHaveAttribute('aria-selected', 'true')
  })

  it('puts the chosen tab in the URL without adding history, and clears it for Overview', async () => {
    const { router } = renderPage()
    const before = router.history.length

    await userEvent.click(await screen.findByRole('tab', { name: 'Faturação' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'billing' }))
    expect(router.history.length).toBe(before)

    await userEvent.click(screen.getByRole('tab', { name: 'Resumo' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
  })

  it('names the People tab for the client kind', async () => {
    renderPage()

    expect(await screen.findByRole('tab', { name: 'Empregados' })).toBeInTheDocument()
  })

  it('counts overdue obligations on the Obligations tab once Overview has loaded them', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    listObligations.mockResolvedValue([
      {
        id: 'o1',
        clientId: '1',
        clientName: company.name,
        definitionCode: 'VAT_MONTHLY_RETURN',
        definitionName: 'Declaração periódica de IVA',
        authority: 'TAX',
        periodLabel: '2026-01',
        dueDate: yesterday,
        dueDateOverridden: false,
        status: 'PENDING',
        completedAt: null,
        reference: null,
        amountCents: null,
        notes: null,
      },
    ])
    renderPage()

    expect(await screen.findByRole('tab', { name: /obrigações\s*1/i })).toBeInTheDocument()
  })

  it('links to the edit page', async () => {
    renderPage()

    expect(await screen.findByRole('link', { name: /^editar$/i })).toHaveAttribute('href', '/clients/1/edit')
    expect(screen.getByRole('button', { name: /^arquivar$/i })).toBeInTheDocument()
  })

  // The server refuses to edit an archived client; the button is not offered.
  it('offers no Edit for an archived client, only Restore, and marks it archived', async () => {
    getClient.mockResolvedValue({ ...company, archivedAt: '2026-09-01T10:00:00.000Z' })
    renderPage()

    expect(await screen.findByRole('button', { name: /^restaurar$/i })).toBeInTheDocument()
    expect(screen.getByText('Arquivado')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^editar$/i })).not.toBeInTheDocument()
  })

  it('archives from the header', async () => {
    archiveClient.mockResolvedValue({ ...company, archivedAt: '2026-09-01T10:00:00.000Z' })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /^arquivar$/i }))

    await waitFor(() => expect(archiveClient).toHaveBeenCalledWith('1'))
  })

  // Below md the actions move into a menu (the CSS switch itself is the e2e's).
  it('offers Edit and Archive in the mobile actions menu', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Ações do cliente' }))

    expect(await screen.findByRole('menuitem', { name: /^editar$/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^arquivar$/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- ClientDetailPage
```

Expected: FAIL — no tabs, no skeleton, no actions menu.

- [ ] **Step 3: Write `ClientDetailSkeleton.tsx`**

```tsx
import { Card, Skeleton } from '../ui'

/** Header block, tab strip, and the Overview's two columns. */
export function ClientDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-4">
        <Skeleton width="5rem" height="0.75rem" />
        <Skeleton width="16rem" height="2rem" />
        <Skeleton width="20rem" height="1rem" />
      </div>
      <div className="flex gap-4 border-b border-line pb-3">
        {[0, 1, 2, 3, 4].map((tab) => (
          <Skeleton key={tab} width="5.5rem" height="1rem" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <Skeleton height="10rem" />
        </Card>
        <Card>
          <Skeleton height="6rem" />
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Write `ClientHeader.tsx`**

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, MoreHorizontal } from 'lucide-react'
import type { LegalForm } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Badge, Button, DropdownMenu } from '../ui'
import { archiveClient, restoreClient } from './api'
import type { ClientResponse } from './api'
import { KIND_TONE } from './kindTone'

/**
 * The page's only `<h1>`. Not a `PageHeader`: the meta line is richer than a
 * description string. Actions sit beside the name from md; below it, in a
 * menu, so the name keeps the width.
 */
export function ClientHeader({ client }: { client: ClientResponse }) {
  const { t } = useTranslation(['clients', 'common', 'domain'])
  const queryClient = useQueryClient()
  const archived = client.archivedAt !== null

  const archive = useMutation({
    mutationFn: () => archiveClient(client.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['client', client.id] })
    },
  })

  const restore = useMutation({
    mutationFn: () => restoreClient(client.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['client', client.id] })
    },
  })

  const meta = [
    // Guaranteed non-null only for a COMPANY, whose legalForm is always one of LEGAL_FORM_VALUES.
    client.legalForm === null ? null : t(`domain:legalForm.${client.legalForm as LegalForm}`),
    t(`domain:accounting.${client.accounting}`),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/clients"
        className="inline-flex items-center gap-1 self-start text-xs font-medium text-muted hover:text-ink"
      >
        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        {t('clients:title')}
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone={KIND_TONE[client.kind]}>{t(`domain:clientKind.${client.kind}`)}</Badge>
            <span className="tabular-nums">{client.taxId}</span>
            <span>{meta}</span>
            {archived && <Badge tone="neutral">{t('clients:archived')}</Badge>}
          </p>
        </div>

        <div className="hidden shrink-0 items-center gap-4 md:flex">
          {!archived && (
            <Button asChild variant="secondary">
              <Link to="/clients/$clientId/edit" params={{ clientId: client.id }}>
                {t('common:actions.edit')}
              </Link>
            </Button>
          )}
          {archived ? (
            <Button variant="secondary" onClick={() => restore.mutate()} isLoading={restore.isPending}>
              {t('common:actions.restore')}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => archive.mutate()} isLoading={archive.isPending}>
              {t('common:actions.archive')}
            </Button>
          )}
        </div>

        <div className="md:hidden">
          <DropdownMenu>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('clients:actions')}>
                <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {!archived && (
                <DropdownMenu.Item asChild>
                  <Link to="/clients/$clientId/edit" params={{ clientId: client.id }}>
                    {t('common:actions.edit')}
                  </Link>
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item onSelect={() => (archived ? restore.mutate() : archive.mutate())}>
                {archived ? t('common:actions.restore') : t('common:actions.archive')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        </div>
      </header>

      <ErrorMessage error={archive.error} />
      <ErrorMessage error={restore.error} />
    </div>
  )
}
```

- [ ] **Step 5: Rewrite `ClientDetailPage.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { groupByUrgency } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Badge, Tabs } from '../ui'
import { ClientLedgerSection } from '../billing/ClientLedgerSection'
import { EmploymentSection } from '../employments/EmploymentSection'
import { ObligationsSection } from '../obligations/ObligationsSection'
import { listObligations } from '../obligations/api'
import { CredentialsSection } from '../vault/CredentialsSection'
import { useVaultState } from '../vault/vault-session'
import { getClient } from './api'
import { ClientDetailSkeleton } from './ClientDetailSkeleton'
import { ClientHeader } from './ClientHeader'
import { ClientOverviewTab } from './ClientOverviewTab'
import { isClientTab } from './clientTabs'

/**
 * A header and five tabs. Only the active tab is mounted, so each tab's
 * queries run when it is opened — except what Overview's summary needs, which
 * Overview fetches under the Obligations and Billing tabs' own keys.
 */
export function ClientDetailPage() {
  const { clientId } = useParams({ from: '/clients/$clientId' })
  const { tab = 'overview' } = useSearch({ from: '/clients/$clientId' })
  const navigate = useNavigate()
  const { t } = useTranslation(['clients', 'employments'])
  const vaultState = useVaultState()

  const client = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => getClient(clientId),
  })

  // Read from the cache only, for the tab badge: Overview and the Obligations
  // tab fetch this key; the badge never fetches it on its own.
  const obligations = useQuery({
    queryKey: ['obligations', clientId],
    queryFn: () => listObligations({ clientId }),
    enabled: false,
  })

  if (client.isPending) return <ClientDetailSkeleton />
  if (client.isError) return <ErrorMessage error={client.error} />

  const record = client.data
  const overdue = obligations.data === undefined ? 0 : groupByUrgency(obligations.data, new Date()).overdue.length

  function selectTab(next: string) {
    if (!isClientTab(next)) return
    // replace: Back leaves the client rather than walking the tabs clicked
    // through. Overview is the default, so it keeps a clean URL.
    void navigate({
      to: '/clients/$clientId',
      params: { clientId },
      search: next === 'overview' ? {} : { tab: next },
      replace: true,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <ClientHeader client={record} />

      <Tabs value={tab} onValueChange={selectTab} className="flex flex-col gap-6">
        <Tabs.List>
          <Tabs.Trigger value="overview">{t('clients:tabs.overview')}</Tabs.Trigger>
          <Tabs.Trigger value="obligations">
            {t('clients:tabs.obligations')}
            {overdue > 0 && <Badge tone="danger">{overdue}</Badge>}
          </Tabs.Trigger>
          <Tabs.Trigger value="billing">{t('clients:tabs.billing')}</Tabs.Trigger>
          <Tabs.Trigger value="people">
            {record.kind === 'COMPANY' ? t('employments:employeesTitle') : t('employments:employmentsTitle')}
          </Tabs.Trigger>
          <Tabs.Trigger value="credentials">
            {t('clients:tabs.credentials')}
            {vaultState.status === 'locked' && <Lock aria-hidden="true" className="h-3.5 w-3.5 text-subtle" />}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview">
          <ClientOverviewTab client={record} />
        </Tabs.Content>
        <Tabs.Content value="obligations">
          <ObligationsSection clientId={clientId} />
        </Tabs.Content>
        <Tabs.Content value="billing">
          <ClientLedgerSection clientId={clientId} />
        </Tabs.Content>
        <Tabs.Content value="people">
          <EmploymentSection client={{ id: record.id, kind: record.kind, name: record.name }} />
        </Tabs.Content>
        <Tabs.Content value="credentials">
          <CredentialsSection clientId={clientId} />
        </Tabs.Content>
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 6: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- ClientDetailPage ClientOverviewTab FiscalProfileForm
pnpm --filter @ledger-hq/web test
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 11 `ClientDetailPage` tests PASS, and the whole suite stays green. If the badge test fails, check the obligations query in the page uses exactly `['obligations', clientId]` — the badge only sees what Overview put in the cache.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/clients/ClientHeader.tsx apps/web/src/clients/ClientDetailSkeleton.tsx apps/web/src/clients/ClientDetailPage.tsx apps/web/src/clients/ClientDetailPage.test.tsx
git commit -m "feat(web): rebuild the client page as a header and five tabs" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: `ObligationRow`

**Files:**
- Create: `apps/web/src/obligations/statusTone.ts`
- Modify: `apps/web/src/obligations/ObligationRow.tsx`
- Test: `apps/web/src/obligations/ObligationRow.test.tsx`
- Tests (unchanged, must pass): `apps/web/src/obligations/ObligationsDashboard.test.tsx`, `apps/web/src/HomePage.test.tsx`

**Interfaces:**
- Consumes: `Badge`, `Button`, `BadgeTone` from `../ui`; `formatDate`, `formatQuarter` from `../i18n/format`; `obligations:row.overridden` (Task 2).
- Produces: `export const STATUS_TONE: Record<ObligationStatus, BadgeTone>`. `ObligationRow` keeps its props and its `<li>` root; it is still shared with the dashboard (spec §7.2.1).

- [ ] **Step 1: Write the failing tests**

Append inside `describe('ObligationRow', …)` in `apps/web/src/obligations/ObligationRow.test.tsx`:

```tsx
  it('shows the period under the name, readable when it is a quarter', () => {
    renderRow({ periodLabel: '2026-Q1' })
    expect(screen.getByText('1.º trimestre de 2026')).toBeInTheDocument()
  })

  it('marks an overdue due date in danger red', () => {
    renderRow({ dueDate: '2020-01-31' })
    expect(screen.getByText('31/01/2020').parentElement).toHaveClass('text-danger-700')
  })

  it('does not mark a future due date', () => {
    renderRow({ dueDate: '2999-01-31' })
    expect(screen.getByText('31/01/2999').parentElement).not.toHaveClass('text-danger-700')
  })

  it('flags a due date changed by hand, in words for a screen reader', () => {
    renderRow({ dueDateOverridden: true })
    expect(screen.getByText('Data alterada manualmente')).toHaveClass('sr-only')
  })

  it('shows a status badge only when the status is not pending', () => {
    renderRow()
    expect(screen.queryByText('Pendente')).not.toBeInTheDocument()
  })

  it('shows the in-progress status as a badge', () => {
    renderRow({ status: 'IN_PROGRESS' })
    expect(screen.getByText('Em curso')).toBeInTheDocument()
  })

  it('offers Edit as a button when the section passes onEdit', async () => {
    const { onEdit } = renderRow()
    await userEvent.click(screen.getByRole('button', { name: /^editar$/i }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- ObligationRow
```

Expected: FAIL — no period caption, no danger tone, no overridden text, no status badge.

- [ ] **Step 3: Write `statusTone.ts`**

```ts
import type { ObligationStatus } from '@ledger-hq/domain'
import type { BadgeTone } from '../ui'

/** Pending is the normal state and carries no badge; the row shows the others. */
export const STATUS_TONE: Record<ObligationStatus, BadgeTone> = {
  PENDING: 'neutral',
  IN_PROGRESS: 'accent',
  DONE: 'success',
  WAIVED: 'neutral',
}
```

- [ ] **Step 4: Rewrite `ObligationRow.tsx`**

```tsx
import { useTranslation } from 'react-i18next'
import { Paperclip, PencilLine } from 'lucide-react'
import type { ObligationStatus } from '@ledger-hq/domain'
import { formatDate, formatQuarter } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Badge, Button } from '../ui'
import type { ObligationResponse } from './api'
import { STATUS_TONE } from './statusTone'

type Props = {
  obligation: ObligationResponse
  showClient: boolean
  onMarkDone: () => void
  /** Omitted on the global dashboard (mark-done only, per design doc 3.4); provided by the per-client section, which hosts the full manual-adjustment controls. */
  onEdit?: () => void
  /** Omitted on the global dashboard, which is mark-done only (design doc §3.4); supplied by the per-client section. */
  onManageAttachments?: () => void
}

/** Today as a UTC calendar date — the same day boundary `groupByUrgency` uses. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Draws its own bordered surface, so its lists are plain `<ul>`s, not cards. */
export function ObligationRow({ obligation, showClient, onMarkDone, onEdit, onManageAttachments }: Props) {
  const { t, i18n } = useTranslation(['obligations', 'domain'])
  const locale = i18n.language as SupportedLocale
  const status = obligation.status as ObligationStatus
  const isActionable = status === 'PENDING' || status === 'IN_PROGRESS'
  const isOverdue = isActionable && obligation.dueDate < todayIso()

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-surface border border-line bg-surface px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">
          {showClient ? `${obligation.clientName} — ` : ''}
          {obligation.definitionName}
        </span>
        <span className="text-xs text-muted">{formatQuarter(obligation.periodLabel, locale)}</span>
      </div>

      <span className={`flex items-center gap-1 text-sm tabular-nums${isOverdue ? ' text-danger-700' : ''}`}>
        <span>{formatDate(obligation.dueDate, locale)}</span>
        {obligation.dueDateOverridden && (
          <>
            <PencilLine aria-hidden="true" className="h-3.5 w-3.5 text-subtle" />
            <span className="sr-only">{t('obligations:row.overridden')}</span>
          </>
        )}
      </span>

      {status !== 'PENDING' && <Badge tone={STATUS_TONE[status]}>{t(`domain:obligationStatus.${status}`)}</Badge>}

      <div className="flex items-center gap-2">
        {isActionable && (
          <Button variant="secondary" size="sm" onClick={onMarkDone}>
            {t('obligations:row.markDone')}
          </Button>
        )}
        {/* As today: a done or waived obligation is not adjusted from its row. */}
        {isActionable && onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            {t('obligations:row.edit')}
          </Button>
        )}
        {onManageAttachments && (
          <Button variant="ghost" size="sm" onClick={onManageAttachments}>
            <Paperclip aria-hidden="true" className="h-3.5 w-3.5" />
            {t('obligations:attachments.manage')}
          </Button>
        )}
      </div>
    </li>
  )
}
```

- [ ] **Step 5: Run the row, dashboard and home tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- ObligationRow ObligationsDashboard HomePage ObligationsSection
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: PASS — 12 `ObligationRow` tests, and `ObligationsDashboard.test.tsx` and `HomePage.test.tsx` **unchanged** (spec §11). A failure there is a regression in the row, not a test to edit. `ObligationsSection.test.tsx` passes too: the row's buttons keep their names.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/obligations/statusTone.ts apps/web/src/obligations/ObligationRow.tsx apps/web/src/obligations/ObligationRow.test.tsx
git commit -m "feat(web): restyle the obligation row" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: The Obligations tab — section, adjust and new-obligation dialogs

**Files:**
- Create: `apps/web/src/obligations/ObligationsSectionSkeleton.tsx`
- Modify: `apps/web/src/obligations/ObligationsSection.tsx`
- Modify: `apps/web/src/obligations/AdjustObligationForm.tsx`
- Modify: `apps/web/src/obligations/AddAdHocObligationForm.tsx`
- Test: `apps/web/src/obligations/ObligationsSection.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `Button`, `Callout`, `Card`, `Dialog`, `EmptyState`, `Input`, `Select`, `Skeleton`, `Textarea` from `../ui`; `ObligationRow` (Task 13); `formatQuarter`.
- Produces: `AdjustObligationForm({ obligation, onSaved }: { obligation: ObligationResponse; onSaved: () => void })` — `onClose` is gone (Cancel is the dialog's `Dialog.Close`); `AddAdHocObligationForm({ clientId, onCreated })` unchanged signature. Both render inside `Dialog.Content`. The receipts dialog still renders today's `ObligationAttachments` with its `onClose` until Task 15 trims it.

- [ ] **Step 1: Rewrite the test file**

`apps/web/src/obligations/ObligationsSection.test.tsx` — keep the header as it is (imports, both `vi.mock`s, `renderSection`, `obligation`), add `waitFor` to the `@testing-library/react` import and `import { ApiError } from '../api/client'`, and replace the whole `describe` block with:

```tsx
describe('ObligationsSection', () => {
  beforeEach(() => {
    listObligationsMock.mockReset()
    generateObligationsMock.mockReset().mockResolvedValue({ toCreate: [], toRetract: [] })
    patchObligationMock.mockReset()
    createAdHocObligationMock.mockReset()
  })

  it('shows the empty state, with the hint, when there are no obligations', async () => {
    listObligationsMock.mockResolvedValue([])
    renderSection()
    expect(await screen.findByText(/ainda não há obrigações/i)).toBeInTheDocument()
    expect(screen.getByText(/preenche o perfil fiscal/i)).toBeInTheDocument()
  })

  it('shows a skeleton while the obligations load', async () => {
    listObligationsMock.mockReturnValue(new Promise(() => {}))
    const { container } = renderSection()
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull())
  })

  it('lists an obligation without the client name (showClient=false)', async () => {
    listObligationsMock.mockResolvedValue([obligation])
    renderSection()
    expect(await screen.findByText(/declaração periódica de iva/i)).toBeInTheDocument()
    expect(screen.queryByText(/padaria central/i)).not.toBeInTheDocument()
  })

  it('shows the generator preview as a callout with an Apply action', async () => {
    listObligationsMock.mockResolvedValue([])
    generateObligationsMock.mockResolvedValue({
      toCreate: [{ clientId: 'c1', definitionCode: 'VAT_MONTHLY_RETURN', periodLabel: '2026-02', dueDate: '2026-04-20' }],
      toRetract: [],
    })
    renderSection()

    expect(await screen.findByText('1 a criar, 0 a retirar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /aplicar/i })).toBeInTheDocument()
  })

  it('clicking Apply calls generateObligations with dryRun=false', async () => {
    listObligationsMock.mockResolvedValue([])
    generateObligationsMock.mockResolvedValueOnce({
      toCreate: [{ clientId: 'c1', definitionCode: 'VAT_MONTHLY_RETURN', periodLabel: '2026-02', dueDate: '2026-04-20' }],
      toRetract: [],
    })
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /aplicar/i }))

    expect(generateObligationsMock).toHaveBeenLastCalledWith({ clientId: 'c1' }, false)
  })

  it('adjusts an obligation in a dialog titled with its name and period, and closes it on save', async () => {
    listObligationsMock.mockResolvedValue([obligation])
    patchObligationMock.mockResolvedValue({ ...obligation, dueDate: '2026-04-01' })
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^editar$/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Declaração periódica de IVA — 2026-01' })
    const dueDate = within(dialog).getByLabelText(/prazo/i)
    await userEvent.clear(dueDate)
    await userEvent.type(dueDate, '2026-04-01')
    await userEvent.click(within(dialog).getByRole('button', { name: /^guardar$/i }))

    expect(patchObligationMock).toHaveBeenCalledWith('o1', expect.objectContaining({ dueDate: '2026-04-01' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // Spec §7.2: "waived needs a reason" is the notes field's own error now.
  it('blocks saving WAIVED with no notes, with the notes field in error', async () => {
    listObligationsMock.mockResolvedValue([obligation])
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^editar$/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText(/estado/i), 'WAIVED')

    const notes = within(dialog).getByLabelText(/notas/i)
    expect(notes).toHaveAttribute('aria-invalid', 'true')
    expect(notes).toHaveAccessibleDescription(/indica o motivo/i)
    expect(within(dialog).getByRole('button', { name: /^guardar$/i })).toBeDisabled()
    expect(patchObligationMock).not.toHaveBeenCalled()
  })

  it('creates an ad-hoc obligation from the New obligation dialog', async () => {
    listObligationsMock.mockResolvedValue([])
    createAdHocObligationMock.mockResolvedValue({ ...obligation, id: 'o2', definitionCode: 'BACKUP_RESTORE_DRILL' })
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /nova obrigação personalizada/i }))
    const dialog = await screen.findByRole('dialog', { name: /nova obrigação personalizada/i })
    await userEvent.type(within(dialog).getByLabelText(/código/i), 'BACKUP_RESTORE_DRILL')
    await userEvent.type(within(dialog).getByLabelText(/designação/i), 'Backup restore drill')
    await userEvent.type(within(dialog).getByLabelText(/período/i), '2026')
    await userEvent.type(within(dialog).getByLabelText(/prazo/i), '2026-06-30')
    await userEvent.click(within(dialog).getByRole('button', { name: /^criar$/i }))

    await vi.waitFor(() =>
      expect(createAdHocObligationMock).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'c1', code: 'BACKUP_RESTORE_DRILL', name: 'Backup restore drill' }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // Review Focus 5, for this tab's creation dialog.
  it('keeps the New obligation dialog open, with what was typed, when creating fails', async () => {
    listObligationsMock.mockResolvedValue([])
    createAdHocObligationMock.mockRejectedValue(new ApiError('common.internal_error', {}, 500))
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /nova obrigação personalizada/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/código/i), 'X')
    await userEvent.type(within(dialog).getByLabelText(/designação/i), 'Y')
    await userEvent.type(within(dialog).getByLabelText(/período/i), '2026')
    await userEvent.type(within(dialog).getByLabelText(/prazo/i), '2026-06-30')
    await userEvent.click(within(dialog).getByRole('button', { name: /^criar$/i }))

    expect(await within(dialog).findByText(/ocorreu um erro no servidor/i)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/código/i)).toHaveValue('X')
  })

  describe('receipts', () => {
    it('opens a dialog for the row whose receipts button was pressed', async () => {
      listObligationsMock.mockResolvedValue([{ ...obligation, status: 'DONE' }])
      renderSection()

      await userEvent.click(await screen.findByRole('button', { name: /^comprovativos$/i }))

      expect(await screen.findByRole('dialog', { name: /comprovativos — declaração periódica de iva/i })).toBeVisible()
    })

    // Design §3.7: requiring DONE would force the operator to mark an
    // obligation done before filing the proof that it is done. The UI leads
    // with the affordance on a DONE row because that is when a receipt
    // exists; nothing rejects an earlier upload.
    it('offers receipts on a PENDING obligation too', async () => {
      listObligationsMock.mockResolvedValue([obligation])
      renderSection()

      expect(await screen.findByRole('button', { name: /^comprovativos$/i })).toBeVisible()
    })
  })
})
```

Add `within` to the `@testing-library/react` import as well.

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- ObligationsSection
```

Expected: FAIL — no dialogs, no "Nova obrigação personalizada" button, no empty-state hint, no skeleton.

- [ ] **Step 3: Write `ObligationsSectionSkeleton.tsx`**

```tsx
import { Card, Skeleton } from '../ui'

export function ObligationsSectionSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {[0, 1, 2].map((row) => (
        <Card key={row} padding="sm" className="flex items-center gap-4">
          <Skeleton height="0.875rem" />
          <Skeleton width="5rem" height="0.875rem" />
          <Skeleton width="6.5rem" height="1.75rem" />
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Rewrite `AdjustObligationForm.tsx`**

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { OBLIGATION_STATUS_VALUES } from '@ledger-hq/domain'
import type { ObligationStatus } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Dialog, Input, Select, Textarea } from '../ui'
import { patchObligation } from './api'
import type { ObligationResponse } from './api'

type Props = { obligation: ObligationResponse; onSaved: () => void }

/** Renders inside `Dialog.Content`; Cancel is the dialog's own close. */
export function AdjustObligationForm({ obligation, onSaved }: Props) {
  const { t } = useTranslation(['obligations', 'domain', 'common'])
  const [dueDate, setDueDate] = useState(obligation.dueDate)
  const [status, setStatus] = useState<ObligationStatus>(obligation.status as ObligationStatus)
  const [notes, setNotes] = useState(obligation.notes ?? '')

  const waivedWithoutReason = status === 'WAIVED' && notes.trim() === ''

  const mutation = useMutation({
    mutationFn: () =>
      patchObligation(obligation.id, {
        ...(dueDate !== obligation.dueDate ? { dueDate } : {}),
        ...(status !== obligation.status ? { status } : {}),
        // The server's WAIVED-requires-notes refine checks the payload, not
        // the stored row: omitting `notes` here because it didn't change
        // would 422 on an instance that already has notes, even though the
        // textarea visibly shows a reason. Always send it when waiving.
        ...(status === 'WAIVED' || notes !== (obligation.notes ?? '') ? { notes } : {}),
      }),
    onSuccess: onSaved,
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (waivedWithoutReason) return
        mutation.mutate()
      }}
    >
      <Input
        type="date"
        label={t('obligations:form.dueDate.label')}
        value={dueDate}
        onChange={(event) => setDueDate(event.target.value)}
      />
      <Select
        label={t('obligations:form.status.label')}
        value={status}
        onChange={(event) => setStatus(event.target.value as ObligationStatus)}
      >
        {OBLIGATION_STATUS_VALUES.map((value) => (
          <option key={value} value={value}>
            {t(`domain:obligationStatus.${value}`)}
          </option>
        ))}
      </Select>
      <Textarea
        label={t('obligations:form.notes.label')}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        error={waivedWithoutReason ? t('obligations:form.waiveReasonRequired') : undefined}
      />

      <ErrorMessage error={mutation.error} />

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="primary" type="submit" isLoading={mutation.isPending} disabled={waivedWithoutReason}>
          {t('common:actions.save')}
        </Button>
      </Dialog.Footer>
    </form>
  )
}
```

- [ ] **Step 5: Rewrite `AddAdHocObligationForm.tsx`**

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PERIODICITY_VALUES } from '@ledger-hq/domain'
import type { Periodicity } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Dialog, Input, Select } from '../ui'
import { createAdHocObligation } from './api'

type Props = { clientId: string; onCreated: () => void }

/** Renders inside `Dialog.Content`. A fresh form each time the dialog opens. */
export function AddAdHocObligationForm({ clientId, onCreated }: Props) {
  const { t } = useTranslation(['obligations', 'domain', 'common'])
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [periodicity, setPeriodicity] = useState<Periodicity>('ONE_OFF')
  const [periodLabel, setPeriodLabel] = useState('')
  const [dueDate, setDueDate] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      createAdHocObligation({
        clientId,
        code,
        name,
        periodicity,
        periodStart: dueDate,
        periodEnd: dueDate,
        periodLabel,
        dueDate,
      }),
    onSuccess: onCreated,
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input required label={t('obligations:adHoc.code.label')} value={code} onChange={(event) => setCode(event.target.value)} />
        <Input required label={t('obligations:adHoc.name.label')} value={name} onChange={(event) => setName(event.target.value)} />
        <Select
          label={t('obligations:adHoc.periodicity.label')}
          value={periodicity}
          onChange={(event) => setPeriodicity(event.target.value as Periodicity)}
        >
          {PERIODICITY_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`domain:periodicity.${value}`)}
            </option>
          ))}
        </Select>
        <Input
          required
          label={t('obligations:adHoc.periodLabel.label')}
          value={periodLabel}
          onChange={(event) => setPeriodLabel(event.target.value)}
        />
        <Input
          type="date"
          required
          label={t('obligations:adHoc.dueDate.label')}
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />
      </div>

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

- [ ] **Step 6: Rewrite `ObligationsSection.tsx`**

```tsx
import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, Plus, RefreshCw } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatQuarter } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Button, Callout, Dialog, EmptyState } from '../ui'
import { generateObligations, listObligations, patchObligation } from './api'
import type { ObligationResponse } from './api'
import { AdjustObligationForm } from './AdjustObligationForm'
import { AddAdHocObligationForm } from './AddAdHocObligationForm'
import { ObligationAttachments } from './ObligationAttachments'
import { ObligationRow } from './ObligationRow'
import { ObligationsSectionSkeleton } from './ObligationsSectionSkeleton'

export function ObligationsSection({ clientId }: { clientId: string }) {
  const { t, i18n } = useTranslation('obligations')
  const locale = i18n.language as SupportedLocale
  const queryClient = useQueryClient()
  const titleId = useId()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ObligationResponse | null>(null)
  const [attachmentsFor, setAttachmentsFor] = useState<ObligationResponse | null>(null)

  const obligations = useQuery({
    queryKey: ['obligations', clientId],
    queryFn: () => listObligations({ clientId }),
  })

  const preview = useQuery({
    queryKey: ['obligations-preview', clientId],
    queryFn: () => generateObligations({ clientId }, true),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['obligations', clientId] })

  const markDone = useMutation({
    mutationFn: (id: string) => patchObligation(id, { status: 'DONE' }),
    onSuccess: invalidate,
  })

  const apply = useMutation({
    mutationFn: () => generateObligations({ clientId }, false),
    onSuccess: async () => {
      await invalidate()
      // Applying just resolved every previewed change: set the preview data
      // directly to empty rather than invalidating it, so we don't issue a
      // redundant dry-run request immediately after the apply request.
      queryClient.setQueryData(['obligations-preview', clientId], { toCreate: [], toRetract: [] })
    },
  })

  const hasPendingChanges = (preview.data?.toCreate.length ?? 0) > 0 || (preview.data?.toRetract.length ?? 0) > 0

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id={titleId} className="text-base font-semibold">
          {t('section.title')}
        </h2>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          {t('adHoc.newTitle')}
        </Button>
      </div>

      {hasPendingChanges && preview.data && (
        <Callout
          tone="warning"
          icon={RefreshCw}
          action={
            <Button variant="primary" size="sm" isLoading={apply.isPending} onClick={() => apply.mutate()}>
              {t('section.apply')}
            </Button>
          }
        >
          {t('section.previewMessage', {
            toCreate: preview.data.toCreate.length,
            toRetract: preview.data.toRetract.length,
          })}
        </Callout>
      )}

      <ErrorMessage error={apply.error} />
      <ErrorMessage error={preview.error} />
      <ErrorMessage error={markDone.error} />

      {obligations.isPending ? (
        <ObligationsSectionSkeleton />
      ) : obligations.isError ? (
        <ErrorMessage error={obligations.error} />
      ) : obligations.data.length === 0 ? (
        <EmptyState icon={CalendarCheck} title={t('section.empty')} description={t('section.emptyHint')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {obligations.data.map((obligation) => (
            <ObligationRow
              key={obligation.id}
              obligation={obligation}
              showClient={false}
              onMarkDone={() => markDone.mutate(obligation.id)}
              onEdit={() => setEditing(obligation)}
              onManageAttachments={() => setAttachmentsFor(obligation)}
            />
          ))}
        </ul>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <Dialog.Content title={t('adHoc.newTitle')}>
          <AddAdHocObligationForm
            clientId={clientId}
            onCreated={() => {
              void invalidate()
              setCreating(false)
            }}
          />
        </Dialog.Content>
      </Dialog>

      {/* Opened from a row, not a trigger: Radix returns focus to whatever was
          focused when it opened — the row's own button. */}
      {editing !== null && (
        <Dialog open onOpenChange={(open) => (open ? undefined : setEditing(null))}>
          <Dialog.Content title={`${editing.definitionName} — ${formatQuarter(editing.periodLabel, locale)}`}>
            <AdjustObligationForm
              obligation={editing}
              onSaved={() => {
                void invalidate()
                setEditing(null)
              }}
            />
          </Dialog.Content>
        </Dialog>
      )}

      {attachmentsFor !== null && (
        <Dialog open onOpenChange={(open) => (open ? undefined : setAttachmentsFor(null))}>
          <Dialog.Content title={`${t('attachments.title')} — ${attachmentsFor.definitionName}`}>
            <ObligationAttachments obligation={attachmentsFor} onClose={() => setAttachmentsFor(null)} />
          </Dialog.Content>
        </Dialog>
      )}
    </section>
  )
}
```

- [ ] **Step 7: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- ObligationsSection ObligationRow ObligationAttachments
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 11 `ObligationsSection` tests PASS; `ObligationAttachments.test.tsx` is untouched and still passes.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/obligations/ObligationsSectionSkeleton.tsx apps/web/src/obligations/ObligationsSection.tsx apps/web/src/obligations/AdjustObligationForm.tsx apps/web/src/obligations/AddAdHocObligationForm.tsx apps/web/src/obligations/ObligationsSection.test.tsx
git commit -m "feat(web): move obligation forms into dialogs on the Obligations tab" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Receipts in their dialog, with the inline delete confirmation

**Files:**
- Modify: `apps/web/src/obligations/ObligationAttachments.tsx`
- Test: `apps/web/src/obligations/ObligationAttachments.test.tsx`
- Modify: `apps/web/src/obligations/ObligationsSection.tsx` (drop `onClose`)
- Modify: `apps/web/src/i18n/locales/{pt,en}/obligations.json` (remove `attachments.confirmDelete`, `attachments.close`)

**Interfaces:**
- Consumes: `Button`, `DataList`, `Skeleton` from `../ui`.
- Produces: `ObligationAttachments({ obligation }: { obligation: ObligationResponse })` — no title and no close of its own (the dialog's replace them), no `window.confirm`.

- [ ] **Step 1: Update the tests**

In `apps/web/src/obligations/ObligationAttachments.test.tsx`:

1. In `renderPanel`, render `<ObligationAttachments obligation={obligation} />` (no `onClose`).
2. Replace the two tests `'confirms before deleting, and does nothing when the operator declines'` and `'deletes when the operator confirms'` with:

```tsx
  // Spec §2.6: no window.confirm, and no dialog on top of a dialog — the
  // row's Delete becomes "Delete for good" plus Cancel, in place.
  it('asks again in place before deleting, and Cancel takes the question back', async () => {
    listAttachmentsMock.mockResolvedValue([attachment])
    const confirm = vi.spyOn(window, 'confirm')

    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /eliminar declaração periódica\.pdf/i }))
    expect(screen.getByRole('button', { name: /apagar definitivamente/i })).toBeInTheDocument()
    expect(deleteAttachmentMock).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^cancelar$/i }))
    expect(screen.queryByRole('button', { name: /apagar definitivamente/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /eliminar declaração periódica\.pdf/i })).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('deletes once the operator confirms in place', async () => {
    listAttachmentsMock.mockResolvedValue([attachment])
    deleteAttachmentMock.mockResolvedValue(undefined)

    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /eliminar declaração periódica\.pdf/i }))
    await userEvent.click(screen.getByRole('button', { name: /apagar definitivamente/i }))

    await waitFor(() => expect(deleteAttachmentMock).toHaveBeenCalledWith('o1', 'a1'))
  })

  it('shows the size and the upload date beside the file', async () => {
    listAttachmentsMock.mockResolvedValue([attachment])

    renderPanel()

    expect(await screen.findByText('34 kB · 18/03/2026')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- ObligationAttachments
```

Expected: FAIL — Delete still calls `window.confirm`, and there is no "Apagar definitivamente".

- [ ] **Step 3: Rewrite `ObligationAttachments.tsx`**

```tsx
import { useId, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Loader2, Paperclip } from 'lucide-react'
import { ACCEPTED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Button, DataList, Skeleton } from '../ui'
import type { ObligationResponse } from './api'
import { attachmentDownloadUrl, deleteAttachment, listAttachments, uploadAttachment } from './attachmentsApi'

type Props = { obligation: ObligationResponse }

/** Kilobytes are the right unit here: every accepted file is under 10 MiB. */
function formatSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} kB`
}

/** Renders inside the receipts dialog, which owns the title and the close. */
export function ObligationAttachments({ obligation }: Props) {
  const { t, i18n } = useTranslation(['obligations', 'common', 'errors'])
  const locale = i18n.language as SupportedLocale
  const queryClient = useQueryClient()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [tooLarge, setTooLarge] = useState(false)
  // The one irreversible action here, with no undo behind it: Delete asks
  // again in place rather than through window.confirm or a second dialog.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

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
    onSuccess: () => {
      setConfirmingId(null)
      void invalidate()
    },
  })

  return (
    <div className="flex flex-col gap-4">
      <ErrorMessage error={attachments.error} />
      <ErrorMessage error={upload.error} />
      <ErrorMessage error={remove.error} />
      {tooLarge && <p className="text-sm text-danger-700">{t('errors:attachments.too_large')}</p>}

      {attachments.isPending ? (
        <Skeleton height="2.75rem" />
      ) : (attachments.data?.length ?? 0) === 0 ? (
        // An EmptyState inside a dialog is too heavy (spec §7.2).
        <p className="text-sm text-muted">{t('obligations:attachments.empty')}</p>
      ) : (
        <DataList>
          {attachments.data?.map((file) => (
            <DataList.Row
              key={file.id}
              label={
                <a
                  href={attachmentDownloadUrl(obligation.id, file.id)}
                  download={file.filename}
                  aria-label={t('obligations:attachments.download', { filename: file.filename })}
                  className="font-medium text-accent-700 hover:underline"
                >
                  {file.filename}
                </a>
              }
              value={
                confirmingId === file.id ? (
                  <>
                    <Button variant="danger" size="sm" isLoading={remove.isPending} onClick={() => remove.mutate(file.id)}>
                      {t('obligations:attachments.confirmDeleteAction')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmingId(null)}>
                      {t('common:actions.cancel')}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-muted tabular-nums">
                      {formatSize(file.sizeBytes)} · {formatDate(file.uploadedAt.slice(0, 10), locale)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('obligations:attachments.delete', { filename: file.filename })}
                      onClick={() => setConfirmingId(file.id)}
                    >
                      {t('common:actions.delete')}
                    </Button>
                  </>
                )
              }
            />
          ))}
        </DataList>
      )}

      <div className="flex flex-col gap-1.5">
        {/* A label dressed as a secondary button, with the file input inside
            it and visually hidden: the whole button opens the picker, and the
            input keeps its accessible name and its keyboard focus. */}
        <label
          htmlFor={inputId}
          className="inline-flex cursor-pointer items-center gap-2 self-start rounded-control border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-ground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-600 has-[:focus-visible]:ring-offset-2 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-60"
        >
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept={ACCEPTED_ATTACHMENT_TYPES.join(',')}
            disabled={upload.isPending}
            className="sr-only"
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
          />
          {upload.isPending ? (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Paperclip aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {t('obligations:attachments.add')}
        </label>
        <p className="text-xs text-muted">{t('obligations:attachments.hint')}</p>
        {upload.isPending && <p className="text-xs text-muted">{t('obligations:attachments.uploading')}</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Drop `onClose` at the call site, and the two keys**

In `ObligationsSection.tsx`, the receipts dialog renders `<ObligationAttachments obligation={attachmentsFor} />`.

In both `pt/obligations.json` and `en/obligations.json`, delete `"confirmDelete"` and `"close"` from `"attachments"` — their last references are gone (spec §9).

- [ ] **Step 5: Run the tests, the bundles, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- ObligationAttachments ObligationsSection
pnpm --filter @ledger-hq/web i18n:check
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: PASS. The empty-state test's `queryByRole('img')` still finds nothing — every icon is `aria-hidden`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/obligations/ObligationAttachments.tsx apps/web/src/obligations/ObligationAttachments.test.tsx apps/web/src/obligations/ObligationsSection.tsx apps/web/src/i18n/locales
git commit -m "feat(web): confirm receipt deletion in place inside the receipts dialog" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: The Billing tab's side cards — retainer plan, ageing, credit

**Files:**
- Create: `apps/web/src/billing/RetainerPlanCard.tsx`
- Modify: `apps/web/src/billing/RetainerPlanForm.tsx`
- Create: `apps/web/src/billing/AgeingCard.tsx`
- Create: `apps/web/src/billing/CreditCard.tsx`
- Modify: `apps/web/src/billing/ApplyCreditForm.tsx`
- Test: `apps/web/src/billing/ledgerCards.test.tsx` (new)
- Modify: `apps/web/src/billing/ClientLedgerSection.tsx` (render the two new cards in place of the old plan toggle and credit form — the full restyle is Task 17)
- Test: `apps/web/src/billing/ClientLedgerSection.test.tsx` (the plan and credit cases move to `ledgerCards.test.tsx`)
- Modify: `apps/web/src/i18n/locales/{pt,en}/billing.json` (two label copy changes)

**Interfaces:**
- Consumes: `Badge`, `Button`, `Card`, `DataList`, `Dialog`, `Input`, `Money`, `MoneyInput`, `Select`, `Skeleton` from `../ui`; `getCurrentRetainerPlan`, `createRetainerPlan`, `renewRetainerPlan`, `getReceivables`, `applyCredit` and their types from `./api`; `AGEING_TONE`.
- Produces:
  - `RetainerPlanCard({ clientId, onSaved }: { clientId: string; onSaved: () => void })` — owns `['current-retainer-plan', clientId]` and the plan dialog; `onSaved` is the section's ledger/receivables invalidation.
  - `AgeingCard({ clientId }: { clientId: string })` — reads `['receivables']`; renders nothing when the client has no row.
  - `CreditCard({ clientId, availableCreditCents, onApplied }: { clientId: string; availableCreditCents: number; onApplied: () => void })` — renders nothing at zero credit; a `<section>` named by its title otherwise.
  - `RetainerPlanForm({ clientId, currentPlan, onSaved })` and `ApplyCreditForm({ clientId, proposal, onApplied }: { clientId: string; proposal: ApplyCreditResult; onApplied: () => void })` — both render inside `Dialog.Content`.

- [ ] **Step 1: Change the two retainer-plan labels**

`billing:retainerPlan.amountCents.label` → `"Valor mensal"` / `"Monthly amount"`; `billing:retainerPlan.newAmountCents.label` → `"Novo valor"` / `"New amount"` (spec §9). The amount is typed in euros from this task on.

- [ ] **Step 2: Write the failing tests**

`apps/web/src/billing/ledgerCards.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const getCurrentRetainerPlan = vi.hoisted(() => vi.fn())
const createRetainerPlan = vi.hoisted(() => vi.fn())
const renewRetainerPlan = vi.hoisted(() => vi.fn())
const getReceivables = vi.hoisted(() => vi.fn())
const applyCredit = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getCurrentRetainerPlan, createRetainerPlan, renewRetainerPlan, getReceivables, applyCredit }))

const { RetainerPlanCard } = await import('./RetainerPlanCard')
const { AgeingCard } = await import('./AgeingCard')
const { CreditCard } = await import('./CreditCard')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderWith(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>{children}</I18nextProvider>
    </QueryClientProvider>,
  )
}

const plan = {
  id: 'plan-1',
  clientId: 'c1',
  amountCents: 9000,
  periodicity: 'MONTHLY',
  dueDayOfMonth: 8,
  validFrom: '2026-01-01',
  validTo: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RetainerPlanCard', () => {
  it('says there is no plan, and offers to create one in a dialog typed in euros', async () => {
    getCurrentRetainerPlan.mockResolvedValue(null)
    createRetainerPlan.mockResolvedValue(plan)
    const onSaved = vi.fn()
    renderWith(<RetainerPlanCard clientId="c1" onSaved={onSaved} />)

    expect(await screen.findByText('Sem avença em vigor.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /criar plano de retainer/i }))

    const dialog = await screen.findByRole('dialog', { name: /criar plano de retainer/i })
    await userEvent.type(within(dialog).getByLabelText(/valor mensal/i), '90,00')
    await userEvent.clear(within(dialog).getByLabelText(/dia de vencimento/i))
    await userEvent.type(within(dialog).getByLabelText(/dia de vencimento/i), '8')
    await userEvent.type(within(dialog).getByLabelText(/em vigor desde/i), '2026-01-01')
    await userEvent.click(within(dialog).getByRole('button', { name: /^guardar$/i }))

    await waitFor(() =>
      expect(createRetainerPlan).toHaveBeenCalledWith('c1', {
        amountCents: 9000,
        periodicity: 'MONTHLY',
        dueDayOfMonth: 8,
        validFrom: '2026-01-01',
      }),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('describes the plan in force and offers to update the fee', async () => {
    getCurrentRetainerPlan.mockResolvedValue(plan)
    renewRetainerPlan.mockResolvedValue({ closedPlanId: 'plan-1', newPlanId: 'plan-2' })
    renderWith(<RetainerPlanCard clientId="c1" onSaved={() => {}} />)

    expect(await screen.findByText('Mensal')).toBeInTheDocument()
    expect(screen.getByText('01/01/2026')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /atualizar valor/i }))

    const dialog = await screen.findByRole('dialog', { name: /atualizar valor/i })
    expect(within(dialog).queryByLabelText(/periodicidade/i)).not.toBeInTheDocument()
    // "Novo valor" alone: the date is "Novo valor a partir de".
    await userEvent.type(within(dialog).getByLabelText(/^novo valor$/i), '120')
    await userEvent.type(within(dialog).getByLabelText(/a partir de/i), '2026-06-01')
    await userEvent.click(within(dialog).getByRole('button', { name: /^guardar$/i }))

    await waitFor(() =>
      expect(renewRetainerPlan).toHaveBeenCalledWith('c1', { newAmountCents: 12000, effectiveFrom: '2026-06-01' }),
    )
  })

  it('cannot be saved without a positive amount', async () => {
    getCurrentRetainerPlan.mockResolvedValue(null)
    renderWith(<RetainerPlanCard clientId="c1" onSaved={() => {}} />)

    await userEvent.click(await screen.findByRole('button', { name: /criar plano de retainer/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/valor mensal/i), '0')
    await userEvent.type(within(dialog).getByLabelText(/em vigor desde/i), '2026-01-01')

    expect(within(dialog).getByRole('button', { name: /^guardar$/i })).toBeDisabled()
  })
})

describe('AgeingCard', () => {
  it('renders nothing for a client with nothing outstanding', async () => {
    getReceivables.mockResolvedValue([])
    const { container } = renderWith(<AgeingCard clientId="c1" />)

    await waitFor(() => expect(getReceivables).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it("shows the client's bucket, amount and oldest due date", async () => {
    getReceivables.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Padaria Central',
        grossOutstandingCents: 27_000,
        creditCents: 0,
        outstandingCents: 27_000,
        oldestDueOn: '2026-01-08',
        ageingBucket: '61-90',
      },
    ])
    renderWith(<AgeingCard clientId="c1" />)

    expect(await screen.findByText('61-90 dias')).toBeInTheDocument()
    expect(screen.getByText(/vence a 08\/01\/2026/i)).toBeInTheDocument()
  })
})

describe('CreditCard', () => {
  const proposal = {
    proposed: [{ paymentId: 'p1', chargeId: 'ch1', amountCents: 9000, description: 'Retainer — 2026-01', periodLabel: '2026-01', dueOn: '2026-01-08' }],
    remainingCreditCents: 18000,
    allocated: 0,
  }

  it('renders nothing without credit', () => {
    const { container } = renderWith(<CreditCard clientId="c1" availableCreditCents={0} onApplied={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('proposes first, shows the proposal in a dialog, and only writes on Confirm', async () => {
    applyCredit.mockResolvedValueOnce(proposal).mockResolvedValueOnce({ proposed: [], remainingCreditCents: 18000, allocated: 1 })
    const onApplied = vi.fn()
    renderWith(<CreditCard clientId="c1" availableCreditCents={27000} onApplied={onApplied} />)

    expect(screen.getByRole('region', { name: 'Crédito disponível' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /aplicar crédito/i }))

    const dialog = await screen.findByRole('dialog', { name: 'Crédito disponível' })
    expect(within(dialog).getByText(/retainer — 2026-01/i)).toBeInTheDocument()
    expect(applyCredit).toHaveBeenLastCalledWith('c1', true)

    await userEvent.click(within(dialog).getByRole('button', { name: /^confirmar$/i }))

    await waitFor(() =>
      expect(applyCredit).toHaveBeenLastCalledWith('c1', false, [{ paymentId: 'p1', chargeId: 'ch1', amountCents: 9000 }]),
    )
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('says so in the dialog when there is nothing due to spend the credit on', async () => {
    applyCredit.mockResolvedValueOnce({ proposed: [], remainingCreditCents: 27000, allocated: 0 })
    renderWith(<CreditCard clientId="c1" availableCreditCents={27000} onApplied={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: /aplicar crédito/i }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/não há cobranças vencidas/i)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /^confirmar$/i })).not.toBeInTheDocument()
  })
})
```

In `apps/web/src/billing/ClientLedgerSection.test.tsx`, delete `'shows the renew form, not the create form, when a plan is already in force'` and the whole `describe('client credit', …)` block — both now live in `ledgerCards.test.tsx` — add `getReceivables: vi.fn().mockResolvedValue([])` to its `vi.mock('./api', …)`, and add `getCurrentRetainerPlanMock.mockResolvedValue(null)` to its `beforeEach` (the plan card now renders in every test, and a query function that resolves `undefined` is an error in TanStack Query v5).

- [ ] **Step 3: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- ledgerCards
```

Expected: FAIL — `./RetainerPlanCard`, `./AgeingCard`, `./CreditCard` do not resolve.

- [ ] **Step 4: Rewrite `RetainerPlanForm.tsx`**

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PERIODICITY_VALUES } from '@ledger-hq/domain'
import type { Periodicity } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Dialog, Input, MoneyInput, Select } from '../ui'
import { createRetainerPlan, renewRetainerPlan } from './api'
import type { RetainerPlan } from './api'

type Props = { clientId: string; currentPlan: RetainerPlan | null; onSaved: () => void }

/** Renders inside `Dialog.Content`. Creates a plan, or renews the one in force. */
export function RetainerPlanForm({ clientId, currentPlan, onSaved }: Props) {
  const { t } = useTranslation(['billing', 'domain', 'common'])
  const isRenewal = currentPlan !== null

  const [amountCents, setAmountCents] = useState<number | null>(null)
  const [periodicity, setPeriodicity] = useState<Periodicity>((currentPlan?.periodicity as Periodicity | undefined) ?? 'MONTHLY')
  const [dueDayOfMonth, setDueDayOfMonth] = useState(String(currentPlan?.dueDayOfMonth ?? 8))
  const [effectiveDate, setEffectiveDate] = useState('')

  const mutation = useMutation({
    mutationFn: (cents: number): Promise<RetainerPlan | { closedPlanId: string | null; newPlanId: string }> =>
      isRenewal
        ? renewRetainerPlan(clientId, { newAmountCents: cents, effectiveFrom: effectiveDate })
        : createRetainerPlan(clientId, {
            amountCents: cents,
            periodicity,
            dueDayOfMonth: Number(dueDayOfMonth),
            validFrom: effectiveDate,
          }),
    onSuccess: onSaved,
  })

  // A fee is a positive amount; the form's rule, not MoneyInput's.
  const canSubmit = amountCents !== null && amountCents > 0 && effectiveDate !== ''

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit || amountCents === null) return
        mutation.mutate(amountCents)
      }}
    >
      <MoneyInput
        required
        label={t(isRenewal ? 'billing:retainerPlan.newAmountCents.label' : 'billing:retainerPlan.amountCents.label')}
        onValueChange={setAmountCents}
      />

      {!isRenewal && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={t('billing:retainerPlan.periodicity.label')}
            value={periodicity}
            onChange={(event) => setPeriodicity(event.target.value as Periodicity)}
          >
            {PERIODICITY_VALUES.filter((value) => value !== 'ONE_OFF').map((value) => (
              <option key={value} value={value}>
                {t(`domain:periodicity.${value}`)}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            required
            min={1}
            max={28}
            inputMode="numeric"
            label={t('billing:retainerPlan.dueDayOfMonth.label')}
            value={dueDayOfMonth}
            onChange={(event) => setDueDayOfMonth(event.target.value)}
          />
        </div>
      )}

      <Input
        type="date"
        required
        label={t(isRenewal ? 'billing:retainerPlan.effectiveFrom.label' : 'billing:retainerPlan.validFrom.label')}
        value={effectiveDate}
        onChange={(event) => setEffectiveDate(event.target.value)}
      />

      <ErrorMessage error={mutation.error} />

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="primary" type="submit" isLoading={mutation.isPending} disabled={!canSubmit}>
          {t('common:actions.save')}
        </Button>
      </Dialog.Footer>
    </form>
  )
}
```

- [ ] **Step 5: Write `RetainerPlanCard.tsx`**

```tsx
import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Periodicity } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Button, Card, DataList, Dialog, Money, Skeleton } from '../ui'
import { getCurrentRetainerPlan } from './api'
import { RetainerPlanForm } from './RetainerPlanForm'

type Props = { clientId: string; onSaved: () => void }

export function RetainerPlanCard({ clientId, onSaved }: Props) {
  const { t, i18n } = useTranslation(['billing', 'domain'])
  const locale = i18n.language as SupportedLocale
  const queryClient = useQueryClient()
  const titleId = useId()
  const [editing, setEditing] = useState(false)

  const plan = useQuery({ queryKey: ['current-retainer-plan', clientId], queryFn: () => getCurrentRetainerPlan(clientId) })
  const actionLabel = plan.data === null ? t('billing:retainerPlan.createTitle') : t('billing:retainerPlan.renewTitle')

  return (
    <section aria-labelledby={titleId}>
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-base font-semibold">
            {t('billing:retainerPlan.title')}
          </h2>
          {plan.data !== undefined && (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              {actionLabel}
            </Button>
          )}
        </div>

        {plan.isPending ? (
          <Skeleton height="4rem" />
        ) : plan.isError ? (
          <ErrorMessage error={plan.error} />
        ) : plan.data === null ? (
          <p className="text-sm text-muted">{t('billing:retainerPlan.none')}</p>
        ) : (
          <DataList as="dl">
            <DataList.Row label={t('billing:retainerPlan.amountCents.label')} value={<Money cents={plan.data.amountCents} />} />
            <DataList.Row
              label={t('billing:retainerPlan.periodicity.label')}
              value={t(`domain:periodicity.${plan.data.periodicity as Periodicity}`)}
            />
            <DataList.Row
              label={t('billing:retainerPlan.dueDayOfMonth.label')}
              value={<span className="tabular-nums">{plan.data.dueDayOfMonth}</span>}
            />
            <DataList.Row
              label={t('billing:retainerPlan.validFrom.label')}
              value={<span className="tabular-nums">{formatDate(plan.data.validFrom, locale)}</span>}
            />
          </DataList>
        )}
      </Card>

      <Dialog open={editing} onOpenChange={setEditing}>
        {plan.data !== undefined && (
          <Dialog.Content title={actionLabel}>
            <RetainerPlanForm
              clientId={clientId}
              currentPlan={plan.data}
              onSaved={() => {
                setEditing(false)
                void queryClient.invalidateQueries({ queryKey: ['current-retainer-plan', clientId] })
                onSaved()
              }}
            />
          </Dialog.Content>
        )}
      </Dialog>
    </section>
  )
}
```

- [ ] **Step 6: Write `AgeingCard.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Badge, Card, Money } from '../ui'
import { getReceivables } from './api'
import { AGEING_TONE } from './ageingTone'

/**
 * The client's own row of the receivables list — no new endpoint, and the
 * cache entry is usually warm from the Overview page. A settled client has no
 * row and no ageing, so the card is not rendered at all; nor while loading
 * or on a failure, since it repeats what the ledger already shows.
 */
export function AgeingCard({ clientId }: { clientId: string }) {
  const { t, i18n } = useTranslation('billing')
  const receivables = useQuery({ queryKey: ['receivables'], queryFn: getReceivables })

  const row = receivables.data?.find((candidate) => candidate.clientId === clientId)
  if (row === undefined) return null

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold">{t('ageing.title')}</h2>
        <Badge tone={AGEING_TONE[row.ageingBucket]}>{t(`receivables.bucket.${row.ageingBucket}`)}</Badge>
      </div>
      <Money cents={row.outstandingCents} size="lg" />
      <p className="text-xs text-muted">
        {t('ageing.oldest', { date: formatDate(row.oldestDueOn, i18n.language as SupportedLocale) })}
      </p>
    </Card>
  )
}
```

- [ ] **Step 7: Rewrite `ApplyCreditForm.tsx`**

```tsx
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, DataList, Dialog, Money } from '../ui'
import { formatCurrency, formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { applyCredit } from './api'
import type { ApplyCreditResult } from './api'

type Props = { clientId: string; proposal: ApplyCreditResult; onApplied: () => void }

/** Renders inside the credit dialog: the proposal the card asked for, then Confirm. */
export function ApplyCreditForm({ clientId, proposal, onApplied }: Props) {
  const { t, i18n } = useTranslation(['billing', 'common'])
  const locale = i18n.language as SupportedLocale

  const confirm = useMutation({
    mutationFn: () =>
      applyCredit(
        clientId,
        false,
        // Only the allocation itself goes back on the wire; the description
        // and period the proposal carries are for the operator, and the
        // endpoint's schema is strict — `paymentId` is a `uuidSchema`, so a
        // null one (which this screen's proposals never actually carry,
        // since they all name a real credited payment) is dropped rather
        // than sent, to keep an unreachable case from ever reaching a raw
        // Zod 400.
        proposal.proposed
          .filter((row): row is typeof row & { paymentId: string } => row.paymentId !== null)
          .map((row) => ({ paymentId: row.paymentId, chargeId: row.chargeId, amountCents: row.amountCents })),
      ),
    onSuccess: onApplied,
  })

  if (proposal.proposed.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('billing:credit.nothingToApply')}</p>
        <Dialog.Footer>
          <Dialog.Close asChild>
            <Button variant="secondary">{t('common:actions.close')}</Button>
          </Dialog.Close>
        </Dialog.Footer>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <DataList>
        {proposal.proposed.map((allocation) => (
          <DataList.Row
            key={`${allocation.paymentId}:${allocation.chargeId}`}
            label={
              <span>
                {allocation.description}
                {allocation.dueOn !== null && <span className="text-muted"> · {formatDate(allocation.dueOn, locale)}</span>}
              </span>
            }
            value={<Money cents={allocation.amountCents} />}
          />
        ))}
      </DataList>
      {proposal.remainingCreditCents > 0 && (
        <p className="text-xs text-muted">
          {t('billing:credit.remaining', { amount: formatCurrency(proposal.remainingCreditCents, locale) })}
        </p>
      )}
      <ErrorMessage error={confirm.error} />
      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="primary" isLoading={confirm.isPending} onClick={() => confirm.mutate()}>
          {t('billing:credit.confirm')}
        </Button>
      </Dialog.Footer>
    </div>
  )
}
```

- [ ] **Step 8: Write `CreditCard.tsx`**

```tsx
import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Card, Dialog, Money } from '../ui'
import { applyCredit } from './api'
import type { ApplyCreditResult } from './api'
import { ApplyCreditForm } from './ApplyCreditForm'

type Props = { clientId: string; availableCreditCents: number; onApplied: () => void }

/**
 * Spends credit the client already paid. Renders nothing at all when there is
 * none: an action that can only ever propose an empty list is worse than no
 * action. "Apply credit" asks the server for a proposal first and shows it in
 * a dialog; nothing is written until Confirm.
 */
export function CreditCard({ clientId, availableCreditCents, onApplied }: Props) {
  const { t } = useTranslation('billing')
  const titleId = useId()
  const [proposal, setProposal] = useState<ApplyCreditResult | null>(null)

  const propose = useMutation({
    mutationFn: () => applyCredit(clientId, true),
    onSuccess: (result) => setProposal(result),
  })

  if (availableCreditCents <= 0) return null

  return (
    <section aria-labelledby={titleId}>
      <Card className="flex flex-col gap-4">
        <h2 id={titleId} className="text-base font-semibold">
          {t('credit.title')}
        </h2>
        <Money cents={availableCreditCents} tone="credit" size="lg" />
        <p className="text-xs font-normal text-muted">{t('credit.hint')}</p>
        <ErrorMessage error={propose.error} />
        <Button variant="secondary" size="sm" className="self-start" isLoading={propose.isPending} onClick={() => propose.mutate()}>
          {t('credit.propose')}
        </Button>
      </Card>

      <Dialog open={proposal !== null} onOpenChange={(open) => (open ? undefined : setProposal(null))}>
        {proposal !== null && (
          <Dialog.Content title={t('credit.title')}>
            <ApplyCreditForm
              clientId={clientId}
              proposal={proposal}
              onApplied={() => {
                setProposal(null)
                onApplied()
              }}
            />
          </Dialog.Content>
        )}
      </Dialog>
    </section>
  )
}
```

- [ ] **Step 9: Use the two cards in today's `ClientLedgerSection`**

So the section keeps working until Task 17 restyles it: in `ClientLedgerSection.tsx`, delete the `showPlanForm` state, the `currentPlan` query, the header's "Editar" button and the `{showPlanForm && …RetainerPlanForm…}` block; replace `<ApplyCreditForm … />` with

```tsx
      <RetainerPlanCard clientId={clientId} onSaved={invalidate} />
      {ledger.data !== undefined && (
        <CreditCard clientId={clientId} availableCreditCents={ledger.data.availableCreditCents} onApplied={invalidate} />
      )}
```

and fix the imports (`RetainerPlanCard`, `CreditCard` in; `getCurrentRetainerPlan`, `RetainerPlanForm`, `ApplyCreditForm` out).

- [ ] **Step 10: Run the tests, the bundles, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- ledgerCards ClientLedgerSection
pnpm --filter @ledger-hq/web i18n:check
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 8 `ledgerCards` tests PASS, and the remaining `ClientLedgerSection` tests PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/billing apps/web/src/i18n/locales
git commit -m "feat(web): add the retainer plan, ageing and credit cards" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: The Billing tab — ledger, write-off, payment and new-charge dialogs

**Files:**
- Create: `apps/web/src/billing/ClientLedgerSkeleton.tsx`
- Create: `apps/web/src/billing/WriteOffDialog.tsx`
- Modify: `apps/web/src/billing/ClientLedgerSection.tsx` (rewrite)
- Modify: `apps/web/src/billing/RecordPaymentForm.tsx`
- Modify: `apps/web/src/billing/AddAdHocChargeForm.tsx`
- Test: `apps/web/src/billing/ClientLedgerSection.test.tsx` (rewrite)
- Modify: `apps/web/src/i18n/locales/{pt,en}/billing.json` (two label copy changes)

**Interfaces:**
- Consumes: Task 16's cards; `Badge`, `Button`, `Card`, `DataList`, `Dialog`, `EmptyState`, `Input`, `Money`, `MoneyInput`, `Select`, `Skeleton`, `Textarea` from `../ui`; `LedgerEntry`, `writeOffCharge`, `proposeAllocation`, `recordPayment`, `createAdHocCharge` from `./api`.
- Produces: `ClientLedgerSection({ clientId })` — same export, a `<section>` named "Faturação" holding the ledger card and the side cards; `WriteOffDialog({ entry, onClose, onWrittenOff }: { entry: LedgerEntry | null; onClose: () => void; onWrittenOff: () => void })`; `RecordPaymentForm({ clientId, onRecorded })` and `AddAdHocChargeForm({ clientId, onCreated })` — same props, now rendered inside `Dialog.Content`.

- [ ] **Step 1: Change the two remaining amount labels**

`billing:payment.amountCents.label` and `billing:adHocCharge.amountCents.label` → `"Valor"` / `"Amount"` in both bundles (spec §9).

- [ ] **Step 2: Rewrite the test file**

`apps/web/src/billing/ClientLedgerSection.test.tsx`:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ApiError } from '../api/client'

const getClientLedgerMock = vi.hoisted(() => vi.fn())
const proposeAllocationMock = vi.hoisted(() => vi.fn())
const recordPaymentMock = vi.hoisted(() => vi.fn())
const writeOffChargeMock = vi.hoisted(() => vi.fn())
const getCurrentRetainerPlanMock = vi.hoisted(() => vi.fn())
const getReceivablesMock = vi.hoisted(() => vi.fn())
const createAdHocChargeMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({
  getClientLedger: getClientLedgerMock,
  proposeAllocation: proposeAllocationMock,
  recordPayment: recordPaymentMock,
  applyCredit: vi.fn(),
  writeOffCharge: writeOffChargeMock,
  getCurrentRetainerPlan: getCurrentRetainerPlanMock,
  createRetainerPlan: vi.fn(),
  renewRetainerPlan: vi.fn(),
  getReceivables: getReceivablesMock,
  createAdHocCharge: createAdHocChargeMock,
}))

const { ClientLedgerSection } = await import('./ClientLedgerSection')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ClientLedgerSection clientId="c1" />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

const EMPTY_LEDGER = { entries: [], balanceCents: 0, availableCreditCents: 0 }
const PROPOSAL = {
  proposed: [{ chargeId: 'charge-1', amountCents: 215000, description: 'Retainer — 2026-01', periodLabel: '2026-01', dueOn: '2026-01-08' }],
  excessCents: 0,
}

async function openPaymentDialog() {
  await userEvent.click(await screen.findByRole('button', { name: /registar pagamento/i }))
  return screen.findByRole('dialog', { name: /registar pagamento/i })
}

beforeEach(() => {
  vi.clearAllMocks()
  getClientLedgerMock.mockResolvedValue(EMPTY_LEDGER)
  getCurrentRetainerPlanMock.mockResolvedValue(null)
  getReceivablesMock.mockResolvedValue([])
})

describe('ClientLedgerSection', () => {
  it('shows a skeleton while the ledger loads', async () => {
    getClientLedgerMock.mockReturnValue(new Promise(() => {}))
    const { container } = renderSection()
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull())
  })

  it('shows the empty state, with its hint, with no billing history', async () => {
    renderSection()
    expect(await screen.findByText(/sem movimentos de faturação/i)).toBeInTheDocument()
    expect(screen.getByText(/as avenças e cobranças aparecem aqui/i)).toBeInTheDocument()
  })

  it('lists entries with their dates, and the balance as the total', async () => {
    getClientLedgerMock.mockResolvedValue({
      entries: [
        { type: 'CHARGE', date: '2026-01-01', description: 'Retainer — 2026-01', amountCents: 9000, runningBalanceCents: 9000, chargeId: 'charge-1', writtenOff: false },
        { type: 'PAYMENT', date: '2026-01-10', description: 'Pagamento — TRANSFER', amountCents: -9000, runningBalanceCents: 0, chargeId: null, writtenOff: false },
      ],
      balanceCents: 0,
      availableCreditCents: 0,
    })
    renderSection()

    expect(await screen.findByText(/retainer — 2026-01/i)).toBeInTheDocument()
    expect(screen.getByText('01/01/2026')).toBeInTheDocument()
    expect(screen.getByText(/pagamento — transfer/i)).toBeInTheDocument()
    expect(screen.getByText('Saldo')).toBeInTheDocument()
  })

  // Spec §2.5: only "written off" gets a badge — the ledger carries no paid state.
  it('badges a written-off charge and offers no write-off on it', async () => {
    getClientLedgerMock.mockResolvedValue({
      entries: [
        { type: 'CHARGE', date: '2026-01-01', description: 'Incobrável', amountCents: 50000, runningBalanceCents: 50000, chargeId: 'charge-1', writtenOff: true },
        { type: 'WRITE_OFF', date: '2026-02-01', description: 'Insolvente', amountCents: -50000, runningBalanceCents: 0, chargeId: 'charge-1', writtenOff: true },
      ],
      balanceCents: 0,
      availableCreditCents: 0,
    })
    renderSection()

    expect(await screen.findByText(/incobrável/i)).toBeInTheDocument()
    expect(screen.getAllByText('Anulada').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /perdoar dívida/i })).not.toBeInTheDocument()
  })

  it('writes off a charge through a dialog that requires a reason', async () => {
    getClientLedgerMock.mockResolvedValue({
      entries: [{ type: 'CHARGE', date: '2026-01-01', description: 'Consultoria', amountCents: 50000, runningBalanceCents: 50000, chargeId: 'charge-1', writtenOff: false }],
      balanceCents: 50000,
      availableCreditCents: 0,
    })
    writeOffChargeMock.mockResolvedValue({})
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /perdoar dívida/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Anular cobrança' })
    const submit = within(dialog).getByRole('button', { name: /perdoar dívida/i })
    expect(submit).toBeDisabled()

    await userEvent.type(within(dialog).getByLabelText(/motivo/i), 'Insolvente')
    await userEvent.click(submit)

    await waitFor(() => expect(writeOffChargeMock).toHaveBeenCalledWith('charge-1', 'Insolvente'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // Spec §11: typed in euros, posted in cents.
  it('records a payment typed in euros, proposing then confirming, in cents on the wire', async () => {
    proposeAllocationMock.mockResolvedValue(PROPOSAL)
    recordPaymentMock.mockResolvedValue({ paymentId: 'p1' })
    renderSection()

    const dialog = await openPaymentDialog()
    await userEvent.type(within(dialog).getByLabelText(/^valor$/i), '2150,00')
    await userEvent.type(within(dialog).getByLabelText(/data de receção/i), '2026-09-03')
    await userEvent.click(within(dialog).getByRole('button', { name: /propor alocação/i }))

    await waitFor(() => expect(proposeAllocationMock).toHaveBeenCalledWith('c1', 215000))
    // The proposal names the charge, never its UUID.
    expect(await within(dialog).findByText(/retainer — 2026-01/i)).toBeInTheDocument()
    expect(within(dialog).queryByText('charge-1')).not.toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: /^confirmar$/i }))

    await waitFor(() =>
      expect(recordPaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({ amountCents: 215000, allocations: [{ chargeId: 'charge-1', amountCents: 215000 }] }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // Review Focus 1, at the form: refused, not posted a hundred times too large.
  it('cannot propose a payment typed with a dot as the decimal mark', async () => {
    renderSection()

    const dialog = await openPaymentDialog()
    await userEvent.type(within(dialog).getByLabelText(/^valor$/i), '2150.50')
    await userEvent.type(within(dialog).getByLabelText(/data de receção/i), '2026-09-03')

    expect(within(dialog).getByRole('button', { name: /propor alocação/i })).toBeDisabled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/indica um valor/i)
  })

  it('drops a stale proposal when the amount is edited', async () => {
    proposeAllocationMock.mockResolvedValue(PROPOSAL)
    renderSection()

    const dialog = await openPaymentDialog()
    const amount = within(dialog).getByLabelText(/^valor$/i)
    await userEvent.type(amount, '15')
    await userEvent.type(within(dialog).getByLabelText(/data de receção/i), '2026-01-10')
    await userEvent.click(within(dialog).getByRole('button', { name: /propor alocação/i }))
    expect(await within(dialog).findByText(/retainer — 2026-01/i)).toBeInTheDocument()

    // Correcting the amount must retract the proposal built from the old one,
    // or Confirmar would record the new amount against the old allocations.
    await userEvent.type(amount, '0')

    expect(within(dialog).queryByRole('button', { name: /^confirmar$/i })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /propor alocação/i })).toBeInTheDocument()
  })

  // Review Focus 3: leaving the field reformats it, which is not an edit.
  it('keeps the proposal when the amount field is merely left', async () => {
    proposeAllocationMock.mockResolvedValue(PROPOSAL)
    renderSection()

    const dialog = await openPaymentDialog()
    const amount = within(dialog).getByLabelText(/^valor$/i)
    await userEvent.type(amount, '2150')
    await userEvent.type(within(dialog).getByLabelText(/data de receção/i), '2026-01-10')
    await userEvent.click(within(dialog).getByRole('button', { name: /propor alocação/i }))
    expect(await within(dialog).findByText(/retainer — 2026-01/i)).toBeInTheDocument()

    await userEvent.click(amount)
    await userEvent.tab()

    expect(within(dialog).getByRole('button', { name: /^confirmar$/i })).toBeInTheDocument()
  })

  it('creates an ad-hoc charge typed in euros', async () => {
    createAdHocChargeMock.mockResolvedValue({ id: 'charge-1' })
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /nova cobrança avulsa/i }))
    const dialog = await screen.findByRole('dialog', { name: /nova cobrança avulsa/i })
    await userEvent.type(within(dialog).getByLabelText(/descrição/i), 'Consultoria extra')
    await userEvent.type(within(dialog).getByLabelText(/^valor$/i), '150,00')
    await userEvent.type(within(dialog).getByLabelText(/data de vencimento/i), '2026-10-01')
    await userEvent.click(within(dialog).getByRole('button', { name: /^criar$/i }))

    await waitFor(() =>
      expect(createAdHocChargeMock).toHaveBeenCalledWith({
        clientId: 'c1',
        description: 'Consultoria extra',
        amountCents: 15000,
        dueOn: '2026-10-01',
      }),
    )
  })

  // Review Focus 5.
  it('keeps the new-charge dialog open, with what was typed, when the charge is refused', async () => {
    createAdHocChargeMock.mockRejectedValue(new ApiError('common.internal_error', {}, 500))
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /nova cobrança avulsa/i }))
    const dialog = await screen.findByRole('dialog', { name: /nova cobrança avulsa/i })
    await userEvent.type(within(dialog).getByLabelText(/descrição/i), 'Consultoria extra')
    await userEvent.type(within(dialog).getByLabelText(/^valor$/i), '150,00')
    await userEvent.type(within(dialog).getByLabelText(/data de vencimento/i), '2026-10-01')
    await userEvent.click(within(dialog).getByRole('button', { name: /^criar$/i }))

    expect(await within(dialog).findByText(/ocorreu um erro no servidor/i)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/descrição/i)).toHaveValue('Consultoria extra')
  })

  it('opens the retainer plan dialog from its card', async () => {
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /criar plano de retainer/i }))

    expect(await screen.findByRole('dialog', { name: /criar plano de retainer/i })).toBeInTheDocument()
  })

  it('shows the ageing card only when the client has a receivables row', async () => {
    getReceivablesMock.mockResolvedValue([
      { clientId: 'c1', clientName: 'X', grossOutstandingCents: 9000, creditCents: 0, outstandingCents: 9000, oldestDueOn: '2026-01-08', ageingBucket: '0-30' },
    ])
    renderSection()

    expect(await screen.findByRole('heading', { name: 'Antiguidade' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- ClientLedgerSection
```

Expected: FAIL — the forms are inline, amounts are cents, there is no write-off dialog or skeleton.

- [ ] **Step 4: Write `ClientLedgerSkeleton.tsx`**

```tsx
import { Skeleton } from '../ui'

/** The ledger card's rows while they load; the card and its header are real. */
export function ClientLedgerSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex min-h-[44px] items-center justify-between gap-4 border-b border-line py-3 last:border-b-0">
          <Skeleton width="14rem" height="0.875rem" />
          <Skeleton width="5rem" height="0.875rem" />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Write `WriteOffDialog.tsx`**

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Dialog, Money, Textarea } from '../ui'
import { writeOffCharge } from './api'
import type { LedgerEntry } from './api'

type Props = { entry: LedgerEntry | null; onClose: () => void; onWrittenOff: () => void }

/** Holds the charge being written off; `null` is closed. */
export function WriteOffDialog({ entry, onClose, onWrittenOff }: Props) {
  const { t } = useTranslation('billing')

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {entry !== null && entry.chargeId !== null && (
        <Dialog.Content title={t('writeOff.title')} size="sm">
          <WriteOffForm entry={entry} chargeId={entry.chargeId} onWrittenOff={onWrittenOff} />
        </Dialog.Content>
      )}
    </Dialog>
  )
}

/** Its own component so the reason starts empty every time the dialog opens. */
function WriteOffForm({ entry, chargeId, onWrittenOff }: { entry: LedgerEntry; chargeId: string; onWrittenOff: () => void }) {
  const { t } = useTranslation(['billing', 'common'])
  const [reason, setReason] = useState('')
  const hasReason = reason.trim() !== ''

  const mutation = useMutation({
    mutationFn: () => writeOffCharge(chargeId, reason),
    onSuccess: onWrittenOff,
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!hasReason) return
        mutation.mutate()
      }}
    >
      <p className="flex items-center justify-between gap-4 text-sm">
        <span className="min-w-0 truncate">{entry.description}</span>
        <Money cents={entry.amountCents} />
      </p>
      <Textarea
        required
        label={t('billing:writeOff.reason.label')}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <ErrorMessage error={mutation.error} />
      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="danger" type="submit" isLoading={mutation.isPending} disabled={!hasReason}>
          {t('billing:writeOff.action')}
        </Button>
      </Dialog.Footer>
    </form>
  )
}
```

- [ ] **Step 6: Rewrite `RecordPaymentForm.tsx`**

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PAYMENT_METHOD_VALUES } from '@ledger-hq/domain'
import type { PaymentMethod } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatCurrency, formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Button, DataList, Dialog, Input, Money, MoneyInput, Select } from '../ui'
import { proposeAllocation, recordPayment } from './api'
import type { ProposedAllocationRow } from './api'

type Props = { clientId: string; onRecorded: () => void }

/**
 * Renders inside `Dialog.Content`. Two steps in one dialog: propose an
 * allocation, then confirm it — the footer's primary action changes with
 * the step.
 */
export function RecordPaymentForm({ clientId, onRecorded }: Props) {
  const { t, i18n } = useTranslation(['billing', 'domain', 'common'])
  const locale = i18n.language as SupportedLocale
  const [amountCents, setAmountCents] = useState<number | null>(null)
  const [receivedOn, setReceivedOn] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('TRANSFER')
  const [proposal, setProposal] = useState<{ proposed: ProposedAllocationRow[]; excessCents: number } | null>(null)

  // A proposal is only valid for the amount it was built from. Editing the
  // amount (or the date) after proposing must retract it, or Confirmar would
  // post the new amount against the old allocations — recording, say, a
  // 150,00 € payment with 15,00 € allocated, silently.
  const resetProposal = () => setProposal(null)

  const propose = useMutation({
    mutationFn: (cents: number) => proposeAllocation(clientId, cents),
    onSuccess: (result) => setProposal(result),
  })

  const confirm = useMutation({
    mutationFn: (cents: number) =>
      recordPayment({
        clientId,
        amountCents: cents,
        receivedOn,
        method,
        // Only the allocation half goes back on the wire; the description
        // and period the proposal carries are for the operator, and the
        // endpoint's schema is strict.
        allocations: (proposal?.proposed ?? []).map((row) => ({ chargeId: row.chargeId, amountCents: row.amountCents })),
      }),
    onSuccess: onRecorded,
  })

  const canPropose = amountCents !== null && amountCents > 0 && receivedOn !== ''

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canPropose || amountCents === null) return
        if (proposal === null) propose.mutate(amountCents)
        else confirm.mutate(amountCents)
      }}
    >
      <MoneyInput
        required
        label={t('billing:payment.amountCents.label')}
        onValueChange={(cents) => {
          setAmountCents(cents)
          resetProposal()
        }}
      />
      <Input
        type="date"
        required
        label={t('billing:payment.receivedOn.label')}
        value={receivedOn}
        onChange={(event) => {
          setReceivedOn(event.target.value)
          resetProposal()
        }}
      />
      <Select
        label={t('billing:payment.method.label')}
        value={method}
        onChange={(event) => setMethod(event.target.value as PaymentMethod)}
      >
        {PAYMENT_METHOD_VALUES.map((value) => (
          <option key={value} value={value}>
            {t(`domain:paymentMethod.${value}`)}
          </option>
        ))}
      </Select>

      <ErrorMessage error={propose.error} />

      {proposal !== null && (
        <div className="flex flex-col gap-2">
          <DataList>
            {proposal.proposed.map((allocation) => (
              <DataList.Row
                key={allocation.chargeId}
                label={
                  <span>
                    {allocation.description}
                    {allocation.dueOn !== null && <span className="text-muted"> · {formatDate(allocation.dueOn, locale)}</span>}
                  </span>
                }
                value={<Money cents={allocation.amountCents} />}
              />
            ))}
          </DataList>
          {proposal.excessCents > 0 && (
            <p className="text-xs text-muted">
              {t('billing:payment.excess', { amount: formatCurrency(proposal.excessCents, locale) })}
            </p>
          )}
        </div>
      )}

      <ErrorMessage error={confirm.error} />

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        {proposal === null ? (
          <Button key="propose" variant="primary" type="submit" isLoading={propose.isPending} disabled={!canPropose}>
            {t('billing:payment.propose')}
          </Button>
        ) : (
          <Button key="confirm" variant="primary" type="submit" isLoading={confirm.isPending}>
            {t('billing:payment.confirm')}
          </Button>
        )}
      </Dialog.Footer>
    </form>
  )
}
```

- [ ] **Step 7: Rewrite `AddAdHocChargeForm.tsx`**

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Dialog, Input, MoneyInput } from '../ui'
import { createAdHocCharge } from './api'

type Props = { clientId: string; onCreated: () => void }

/** Renders inside `Dialog.Content`. A fresh form each time the dialog opens. */
export function AddAdHocChargeForm({ clientId, onCreated }: Props) {
  const { t } = useTranslation(['billing', 'common'])
  const [description, setDescription] = useState('')
  const [amountCents, setAmountCents] = useState<number | null>(null)
  const [dueOn, setDueOn] = useState('')

  const mutation = useMutation({
    mutationFn: (cents: number) => createAdHocCharge({ clientId, description, amountCents: cents, dueOn }),
    onSuccess: onCreated,
  })

  const canSubmit = description.trim() !== '' && amountCents !== null && amountCents > 0 && dueOn !== ''

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit || amountCents === null) return
        mutation.mutate(amountCents)
      }}
    >
      <Input
        required
        label={t('billing:adHocCharge.description.label')}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <MoneyInput required label={t('billing:adHocCharge.amountCents.label')} onValueChange={setAmountCents} />
      <Input
        type="date"
        required
        label={t('billing:adHocCharge.dueOn.label')}
        value={dueOn}
        onChange={(event) => setDueOn(event.target.value)}
      />

      <ErrorMessage error={mutation.error} />

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="primary" type="submit" isLoading={mutation.isPending} disabled={!canSubmit}>
          {t('common:actions.create')}
        </Button>
      </Dialog.Footer>
    </form>
  )
}
```

- [ ] **Step 8: Rewrite `ClientLedgerSection.tsx`**

```tsx
import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Receipt } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Badge, Button, Card, DataList, Dialog, EmptyState, Money } from '../ui'
import { getClientLedger } from './api'
import type { LedgerEntry } from './api'
import { AddAdHocChargeForm } from './AddAdHocChargeForm'
import { AgeingCard } from './AgeingCard'
import { ClientLedgerSkeleton } from './ClientLedgerSkeleton'
import { CreditCard } from './CreditCard'
import { RecordPaymentForm } from './RecordPaymentForm'
import { RetainerPlanCard } from './RetainerPlanCard'
import { WriteOffDialog } from './WriteOffDialog'

/**
 * The Billing tab: the ledger, and beside it (below it on a phone) the plan,
 * ageing and credit cards. Each card is its own file; this composes them and
 * owns the ledger's three dialogs.
 */
export function ClientLedgerSection({ clientId }: { clientId: string }) {
  const { t, i18n } = useTranslation(['billing', 'common'])
  const locale = i18n.language as SupportedLocale
  const queryClient = useQueryClient()
  const titleId = useId()
  const [recording, setRecording] = useState(false)
  const [charging, setCharging] = useState(false)
  const [writingOff, setWritingOff] = useState<LedgerEntry | null>(null)

  const ledger = useQuery({ queryKey: ['client-ledger', clientId], queryFn: () => getClientLedger(clientId) })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['client-ledger', clientId] })
    // SummaryRow and ReceivablesSection both read this key; spending credit
    // changes what they show.
    void queryClient.invalidateQueries({ queryKey: ['receivables'] })
  }

  return (
    <section aria-labelledby={titleId} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="flex min-w-0 flex-col gap-4 self-start">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id={titleId} className="text-base font-semibold">
            {t('billing:ledger.title')}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCharging(true)}>
              {t('billing:adHocCharge.newTitle')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setRecording(true)}>
              {t('billing:payment.recordTitle')}
            </Button>
          </div>
        </div>

        {ledger.isPending ? (
          <ClientLedgerSkeleton />
        ) : ledger.isError ? (
          <ErrorMessage error={ledger.error} />
        ) : ledger.data.entries.length === 0 ? (
          <EmptyState icon={Receipt} title={t('billing:ledger.empty')} description={t('billing:ledger.emptyHint')} />
        ) : (
          <DataList>
            {ledger.data.entries.map((entry, index) => (
              <DataList.Row
                key={index}
                label={
                  <span className="flex min-w-0 flex-col md:flex-row md:items-baseline md:gap-4">
                    <span className="text-xs text-muted tabular-nums md:w-24 md:shrink-0">{formatDate(entry.date, locale)}</span>
                    <span className="truncate">{entry.description}</span>
                  </span>
                }
                value={
                  <>
                    {/* The ledger carries no paid state (spec §2.5): only written-off is badged. */}
                    {entry.writtenOff && (
                      <Badge tone="neutral" strikethrough>
                        {t('billing:writeOff.badge')}
                      </Badge>
                    )}
                    {entry.type === 'CHARGE' && entry.chargeId !== null && !entry.writtenOff && (
                      <Button variant="danger" size="sm" onClick={() => setWritingOff(entry)}>
                        {t('billing:writeOff.action')}
                      </Button>
                    )}
                    <Money cents={entry.amountCents} tone={entry.writtenOff ? 'writtenOff' : 'auto'} />
                  </>
                }
              />
            ))}
            <DataList.Total label={t('billing:ledger.balance')} value={<Money cents={ledger.data.balanceCents} />} />
          </DataList>
        )}
      </Card>

      <div className="flex flex-col gap-6">
        <RetainerPlanCard clientId={clientId} onSaved={invalidate} />
        <AgeingCard clientId={clientId} />
        {ledger.data !== undefined && (
          <CreditCard clientId={clientId} availableCreditCents={ledger.data.availableCreditCents} onApplied={invalidate} />
        )}
      </div>

      <Dialog open={recording} onOpenChange={setRecording}>
        <Dialog.Content title={t('billing:payment.recordTitle')}>
          <RecordPaymentForm
            clientId={clientId}
            onRecorded={() => {
              setRecording(false)
              invalidate()
            }}
          />
        </Dialog.Content>
      </Dialog>

      <Dialog open={charging} onOpenChange={setCharging}>
        <Dialog.Content title={t('billing:adHocCharge.newTitle')}>
          <AddAdHocChargeForm
            clientId={clientId}
            onCreated={() => {
              setCharging(false)
              invalidate()
            }}
          />
        </Dialog.Content>
      </Dialog>

      <WriteOffDialog
        entry={writingOff}
        onClose={() => setWritingOff(null)}
        onWrittenOff={() => {
          setWritingOff(null)
          invalidate()
        }}
      />
    </section>
  )
}
```

- [ ] **Step 9: Run the tests, the bundles, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- ClientLedgerSection ledgerCards ClientDetailPage
pnpm --filter @ledger-hq/web i18n:check
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 13 `ClientLedgerSection` tests PASS; `ClientDetailPage`'s Billing-tab test still finds the "Faturação" region.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/billing apps/web/src/i18n/locales
git commit -m "feat(web): restyle the Billing tab with dialogs and amounts in euros" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: The People tab

**Files:**
- Modify: `apps/web/src/employments/EmploymentSection.tsx`
- Modify: `apps/web/src/employments/AddEmploymentForm.tsx`
- Test: `apps/web/src/employments/EmploymentSection.test.tsx`

**Interfaces:**
- Consumes: `Badge`, `Button`, `Card`, `DataList`, `Dialog`, `EmptyState`, `Input`, `Select`, `Skeleton` from `../ui`; `employments:emptyHint` (Task 2).
- Produces: `AddEmploymentForm({ client, onAdded }: { client: { id: string; kind: ClientKind; name: string }; onAdded: () => void })` — renders inside `Dialog.Content`; its schema handling is unchanged. `EmploymentSection` keeps its props.

- [ ] **Step 1: Update the tests**

This file asserts bilingually (it predates the `pt-PT` pin); keep that style. In `apps/web/src/employments/EmploymentSection.test.tsx`, add `within` to the `@testing-library/react` import, then:

1. Replace `'shows an empty state'` with:

```tsx
  it('shows an empty state with its hint', async () => {
    listEmployments.mockResolvedValue([])
    listClients.mockResolvedValue([])
    renderSection('COMPANY', 'c1')

    expect(await screen.findByText(/sem vínculos|no employment/i)).toBeInTheDocument()
    expect(screen.getByText(/regista quem trabalha|record who works/i)).toBeInTheDocument()
  })
```

2. Replace `'shows an error, not a silently empty picker, when eligible counterparties fail to load'` with (the picker only loads once its dialog opens):

```tsx
  it('shows an error, not a silently empty picker, when eligible counterparties fail to load', async () => {
    listEmployments.mockResolvedValue([])
    listClients.mockRejectedValue(new ApiError('common.internal_error', {}, 500))
    renderSection('COMPANY', 'c1')

    await userEvent.click(await screen.findByRole('button', { name: /adicionar vínculo|add employment/i }))
    const dialog = await screen.findByRole('dialog')

    const alert = await within(dialog).findByText(/erro no servidor|server error/i)
    expect(alert).toHaveAttribute('role', 'alert')
  })
```

3. Append:

```tsx
  // createEmploymentSchema requires uuids, so this case uses real-shaped ids.
  it('adds an employment from its dialog, which closes on success', async () => {
    const employerId = '0192f1a0-0000-7000-8000-000000000001'
    const employeeId = '0192f1a0-0000-7000-8000-000000000002'
    listEmployments.mockResolvedValue([])
    listClients.mockResolvedValue([{ id: employeeId, name: 'Maria Santos' }])
    createEmployment.mockResolvedValue(spell)
    renderSection('COMPANY', employerId)

    await userEvent.click(await screen.findByRole('button', { name: /adicionar vínculo|add employment/i }))
    const dialog = await screen.findByRole('dialog', { name: /adicionar vínculo|add employment/i })
    await userEvent.selectOptions(await within(dialog).findByLabelText(/pessoa|person/i), employeeId)
    await userEvent.type(within(dialog).getByLabelText(/data de admissão|start/i), '2024-01-15')
    await userEvent.click(within(dialog).getByRole('button', { name: /adicionar vínculo|add employment/i }))

    await waitFor(() =>
      expect(createEmployment).toHaveBeenCalledWith(expect.objectContaining({ employerId, employeeId, startedOn: '2024-01-15' })),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows the job title under the counterparty', async () => {
    listEmployments.mockResolvedValue([spell])
    listClients.mockResolvedValue([])
    renderSection('COMPANY', 'c1')

    expect(await screen.findByRole('link', { name: 'Maria Santos' })).toBeInTheDocument()
    expect(screen.getByText('Bookkeeper')).toHaveClass('text-xs')
  })
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- EmploymentSection
```

Expected: FAIL — no hint, no Add button opening a dialog.

- [ ] **Step 3: Rewrite `AddEmploymentForm.tsx`**

Keep `FormValues`, `initialValues`, `isErrorCode` with its comment, and `toCandidate` exactly as they are. Replace the imports, `Props` and the component:

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ERROR_CODES, createEmploymentSchema } from '@ledger-hq/domain'
import type { ClientKind, ErrorCode } from '@ledger-hq/domain'
import { ErrorMessage, translateErrorCode } from '../shell/ErrorMessage'
import { listClients } from '../clients/api'
import { Button, Dialog, Input, Select } from '../ui'
import { createEmployment } from './api'

type Props = { client: { id: string; kind: ClientKind; name: string }; onAdded: () => void }
```

```tsx
/** Renders inside `Dialog.Content`. A fresh form each time the dialog opens. */
export function AddEmploymentForm({ client, onAdded }: Props) {
  const { t } = useTranslation(['employments', 'common'])
  const { t: tError } = useTranslation('errors')
  const queryClient = useQueryClient()
  const isCompany = client.kind === 'COMPANY'

  const [values, setValues] = useState<FormValues>(initialValues)

  const counterparties = useQuery({
    queryKey: ['clients', { kind: isCompany ? 'INDIVIDUAL' : 'COMPANY' }],
    queryFn: () => listClients({ kind: isCompany ? 'INDIVIDUAL' : 'COMPANY' }),
  })

  const parsed = createEmploymentSchema.safeParse(toCandidate(client, isCompany, values))
  const violations: ErrorCode[] = parsed.success
    ? []
    : parsed.error.issues.map((issue) => issue.message).filter(isErrorCode)

  const mutation = useMutation({
    mutationFn: () => {
      // Guarded by `canSubmit` at the only call site (the form's submit
      // handler), so this is never reached with `parsed.success === false`.
      if (!parsed.success) throw new Error('AddEmploymentForm: submitted with invalid input')
      return createEmployment(parsed.data)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employments', client.id] })
      onAdded()
    },
  })

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  const canSubmit =
    values.counterpartyId !== '' && values.startedOn !== '' && violations.length === 0 && parsed.success
  const counterpartyLabel = isCompany ? t('employments:form.employee.label') : t('employments:form.employer.label')

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit) return
        mutation.mutate()
      }}
    >
      <Select
        label={counterpartyLabel}
        value={values.counterpartyId}
        onChange={(event) => update('counterpartyId', event.target.value)}
      >
        <option value="" disabled>
          {counterpartyLabel}
        </option>
        {counterparties.data?.map((counterparty) => (
          <option key={counterparty.id} value={counterparty.id}>
            {counterparty.name}
          </option>
        ))}
      </Select>
      {/*
       * Without this, a failed fetch of eligible counterparties would look
       * identical to "none exist yet" — an empty dropdown with no
       * explanation — the same shape of bug the fiscal profile form used to
       * have before it was fixed to distinguish "no profile yet" from a
       * genuine fetch failure.
       */}
      {counterparties.isError ? <ErrorMessage error={counterparties.error} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          type="date"
          label={t('employments:form.startedOn.label')}
          value={values.startedOn}
          onChange={(event) => update('startedOn', event.target.value)}
        />
        <Input
          type="date"
          label={t('employments:form.endedOn.label')}
          value={values.endedOn}
          onChange={(event) => update('endedOn', event.target.value)}
        />
      </div>
      <Input
        label={t('employments:form.jobTitle.label')}
        value={values.jobTitle}
        onChange={(event) => update('jobTitle', event.target.value)}
      />

      {violations.length > 0 && (
        <ul className="flex flex-col gap-1">
          {violations.map((code) => (
            <li key={code} role="alert" className="text-sm text-danger-700">
              {translateErrorCode(tError, code)}
            </li>
          ))}
        </ul>
      )}

      <ErrorMessage error={mutation.error} />

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="primary" type="submit" isLoading={mutation.isPending} disabled={!canSubmit}>
          {t('employments:add')}
        </Button>
      </Dialog.Footer>
    </form>
  )
}
```

- [ ] **Step 4: Rewrite `EmploymentSection.tsx`**

```tsx
import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Plus, Users } from 'lucide-react'
import type { ClientKind } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Badge, Button, Card, DataList, Dialog, EmptyState, Skeleton } from '../ui'
import { endEmployment, listEmployments } from './api'
import { AddEmploymentForm } from './AddEmploymentForm'

type Props = { client: { id: string; kind: ClientKind; name: string } }

/** Today, as an ISO calendar date — used as the end date for the "end employment" action. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function EmploymentSection({ client }: Props) {
  const { t, i18n } = useTranslation(['employments', 'common'])
  const locale = i18n.language as SupportedLocale
  const queryClient = useQueryClient()
  const titleId = useId()
  const isCompany = client.kind === 'COMPANY'
  const [adding, setAdding] = useState(false)

  const employments = useQuery({
    queryKey: ['employments', client.id],
    queryFn: () => listEmployments(client.id),
  })

  const endMutation = useMutation({
    mutationFn: (id: string) => endEmployment(id, today()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employments', client.id] })
    },
  })

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id={titleId} className="text-base font-semibold">
          {isCompany ? t('employments:employeesTitle') : t('employments:employmentsTitle')}
        </h2>
        <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          {t('employments:add')}
        </Button>
      </div>

      {/*
       * Loading, a genuine fetch failure and "no spells yet" are three
       * distinct branches below, checked in that order — not a single
       * `data?.length === 0` collapse that would render a fetch failure
       * identically to an empty list.
       */}
      {employments.isPending ? (
        <Card padding="none" className="flex flex-col px-5" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex min-h-[44px] items-center justify-between gap-4 border-b border-line py-3 last:border-b-0">
              <Skeleton width="12rem" height="0.875rem" />
              <Skeleton width="8rem" height="0.875rem" />
            </div>
          ))}
        </Card>
      ) : employments.isError ? (
        <ErrorMessage error={employments.error} />
      ) : employments.data.length === 0 ? (
        <EmptyState icon={Users} title={t('employments:empty')} description={t('employments:emptyHint')} />
      ) : (
        <Card padding="none" className="px-5">
          <DataList>
            {employments.data.map((spell) => {
              const counterpartyId = isCompany ? spell.employeeId : spell.employerId
              const counterpartyName = isCompany ? spell.employeeName : spell.employerName
              const isOpen = spell.endedOn === null

              return (
                <DataList.Row
                  key={spell.id}
                  label={
                    <span className="flex min-w-0 flex-col">
                      <Link to="/clients/$clientId" params={{ clientId: counterpartyId }} className="truncate font-medium">
                        {counterpartyName}
                      </Link>
                      {spell.jobTitle !== null && <span className="text-xs text-muted">{spell.jobTitle}</span>}
                    </span>
                  }
                  value={
                    <>
                      <span className="text-muted tabular-nums">
                        {formatDate(spell.startedOn, locale)}
                        {spell.endedOn === null ? '' : ` – ${formatDate(spell.endedOn, locale)}`}
                      </span>
                      {isOpen && (
                        <>
                          <Badge tone="success">{t('employments:current')}</Badge>
                          <Button
                            variant="secondary"
                            size="sm"
                            isLoading={endMutation.isPending && endMutation.variables === spell.id}
                            onClick={() => endMutation.mutate(spell.id)}
                          >
                            {t('employments:end')}
                          </Button>
                        </>
                      )}
                    </>
                  }
                />
              )
            })}
          </DataList>
        </Card>
      )}

      <ErrorMessage error={endMutation.error} />

      <Dialog open={adding} onOpenChange={setAdding}>
        <Dialog.Content title={t('employments:add')}>
          <AddEmploymentForm client={client} onAdded={() => setAdding(false)} />
        </Dialog.Content>
      </Dialog>
    </section>
  )
}
```

- [ ] **Step 5: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- EmploymentSection
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 10 `EmploymentSection` tests PASS, including the ones about ending a spell (the End button keeps its name).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/employments
git commit -m "feat(web): restyle the People tab with the add form in a dialog" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: The vault gate

**Files:**
- Modify: `apps/web/src/vault/vault-session.ts` (export the constant)
- Modify: `apps/web/src/vault/VaultUnlockGate.tsx`
- Test: `apps/web/src/vault/VaultUnlockGate.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Callout`, `Card`, `Input`, `Skeleton` from `../ui`; `vault:unlock.lockedTitle`, `lockedHint` (Task 2).
- Produces: `export const INACTIVITY_LOCK_MS` from `vault-session.ts` (Stage 4 reads it too). `VaultUnlockGate` keeps its props, its `['vault-envelope-resolved', email]` query and its three error branches.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('VaultUnlockGate', …)` in `apps/web/src/vault/VaultUnlockGate.test.tsx`:

```tsx
  // Spec §3: the boards said 15 minutes; the real timeout is the constant's.
  it('says the vault locks again after 5 minutes of inactivity', async () => {
    resolveEnvelopeMock.mockResolvedValue({ kdfSalt: 'AAAA', protectedVaultKey: 'BBBB', setUp: true, fromCache: false })
    renderGate()

    expect(await screen.findByText('O cofre está bloqueado')).toBeInTheDocument()
    expect(screen.getByText(/volta a bloquear após 5 minutos de inatividade/i)).toBeInTheDocument()
  })

  it("puts a wrong password on the password field itself", async () => {
    resolveEnvelopeMock.mockResolvedValue({ kdfSalt: 'AAAA', protectedVaultKey: 'BBBB', setUp: true, fromCache: false })
    unlockWithPasswordMock.mockRejectedValue(new Error('OperationError'))
    renderGate()

    const field = await screen.findByLabelText(/palavra-passe mestra/i)
    await userEvent.type(field, 'wrong password')
    await userEvent.click(screen.getByRole('button', { name: /desbloquear/i }))

    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    expect(field).toHaveAccessibleDescription(/incorreta/i)
  })

  it('keeps the offline message a status region', async () => {
    resolveEnvelopeMock.mockResolvedValue(null)
    renderGate()

    expect(await screen.findByRole('status')).toHaveTextContent(/sem ligação ao servidor/i)
  })

  it('links to vault setup when no vault exists', async () => {
    resolveEnvelopeMock.mockResolvedValue({ kdfSalt: '', protectedVaultKey: '', setUp: false, fromCache: false })
    renderGate()

    expect(await screen.findByRole('link', { name: /configurar agora/i })).toHaveAttribute('href', '/vault/setup')
  })
```

Add `waitFor` to the `@testing-library/react` import.

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- VaultUnlockGate
```

Expected: FAIL — no locked title or hint, and the wrong-password message is a loose paragraph.

- [ ] **Step 3: Export the timeout**

In `apps/web/src/vault/vault-session.ts`, change `const INACTIVITY_LOCK_MS = 5 * 60 * 1000` to

```ts
/** Exported so the screens that mention the timeout state the real one. */
export const INACTIVITY_LOCK_MS = 5 * 60 * 1000
```

- [ ] **Step 4: Rewrite `VaultUnlockGate.tsx`**

```tsx
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { Lock, ShieldAlert, WifiOff } from 'lucide-react'
import { useSession } from '../auth/session'
import { Button, Callout, Card, Input, Skeleton } from '../ui'
import { resolveEnvelope, unlockWithPassword } from './unlock'
import { INACTIVITY_LOCK_MS, useVaultState } from './vault-session'

export function VaultUnlockGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('vault')
  const session = useSession()
  const email = session.data?.email ?? ''
  const vaultState = useVaultState()
  const [masterPassword, setMasterPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const envelope = useQuery({
    queryKey: ['vault-envelope-resolved', email],
    queryFn: () => resolveEnvelope(email),
    enabled: email !== '' && vaultState.status === 'locked',
  })

  if (vaultState.status === 'unlocked') return <>{children}</>
  if (envelope.isPending) {
    return (
      <Card className="mx-auto w-full max-w-md" aria-busy="true">
        <Skeleton height="10rem" />
      </Card>
    )
  }

  // `resolveEnvelope` returns `null` only when it could not reach the server
  // AND nothing was ever cached — a fundamentally different situation from a
  // vault that was checked live and confirmed never set up. Collapsing both
  // into "not set up" tells a user with a genuinely configured vault, who
  // simply hasn't unlocked on this device before, that they need to set one
  // up — which they can't do offline anyway.
  if (envelope.data === null || envelope.data === undefined) {
    return (
      <Callout tone="warning" icon={WifiOff} role="status">
        {t('unlock.offlineUnknown')}
      </Callout>
    )
  }

  if (!envelope.data.setUp) {
    return (
      <Callout
        tone="neutral"
        icon={ShieldAlert}
        action={
          <Button asChild variant="primary" size="sm">
            <Link to="/vault/setup">{t('unlock.setUpLink')}</Link>
          </Button>
        }
      >
        {t('unlock.notSetUp')}
      </Callout>
    )
  }

  return (
    <Card className="mx-auto flex w-full max-w-md flex-col items-center gap-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ground text-muted">
        <Lock aria-hidden="true" className="h-6 w-6" />
      </span>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-base font-semibold">{t('unlock.lockedTitle')}</h3>
        <p className="text-sm font-normal text-muted">
          {t('unlock.lockedHint', { minutes: INACTIVITY_LOCK_MS / 60_000 })}
        </p>
      </div>
      <form
        className="flex w-full flex-col gap-4 text-left"
        onSubmit={(event) => {
          event.preventDefault()
          setPending(true)
          setError(null)
          unlockWithPassword(email, masterPassword)
            .then(() => setMasterPassword(''))
            .catch((error: unknown) => {
              // `unlockWithPassword` throws two distinguishable, non-password
              // errors — see its own doc comment — on top of a genuine
              // wrong-password rejection (AES-KW's own integrity check).
              // Collapsing all three into "incorrect password" told a user
              // with no vault, or one who went offline between page load and
              // submit, that their (irrelevant) password was wrong.
              const message = error instanceof Error ? error.message : ''
              if (message === 'vault not set up') setError(t('unlock.notSetUp'))
              else if (message === 'vault unknown offline') setError(t('unlock.offlineUnknown'))
              else setError(t('unlock.wrongPassword'))
            })
            .finally(() => setPending(false))
        }}
      >
        <Input
          type="password"
          autoComplete="current-password"
          required
          label={t('unlock.passwordLabel')}
          value={masterPassword}
          onChange={(event) => setMasterPassword(event.target.value)}
          error={error ?? undefined}
        />
        <Button variant="primary" type="submit" isLoading={pending} className="w-full">
          {t('unlock.unlockButton')}
        </Button>
      </form>
    </Card>
  )
}
```

- [ ] **Step 5: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- VaultUnlockGate CredentialsSection vault-session
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 10 `VaultUnlockGate` tests PASS — the six existing ones unchanged (their `findByRole('alert')` now finds the field's error).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/vault/vault-session.ts apps/web/src/vault/VaultUnlockGate.tsx apps/web/src/vault/VaultUnlockGate.test.tsx
git commit -m "feat(web): restyle the vault gate and state the real lock timeout" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: The Credentials tab

**Files:**
- Create: `apps/web/src/vault/PlatformAvatar.tsx`
- Test: `apps/web/src/vault/PlatformAvatar.test.tsx`
- Modify: `apps/web/src/vault/CredentialRow.tsx`
- Modify: `apps/web/src/vault/CredentialsSection.tsx`
- Modify: `apps/web/src/vault/AddCredentialForm.tsx`
- Test: `apps/web/src/vault/CredentialsSection.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Card`, `DataList`, `Dialog`, `EmptyState`, `Input`, `Select`, `Skeleton`, `useToast`, `ToastProvider` (test only) from `../ui`; `lockVault`, `useVaultState`; keys from Task 2.
- Produces: `export function PlatformAvatar({ name }: { name: string })` and `export function platformInitials(name: string): string` — Stage 4's Vault page reuses the avatar. `CredentialRow` and `CredentialsSection` keep their props; `CredentialRow` keeps its local `copyAndClear` (Stage 4 moves it to `vault/clipboard.ts`). `CredentialsSection` must render under a `ToastProvider` (the shell provides one).

- [ ] **Step 1: Write the failing tests**

`apps/web/src/vault/PlatformAvatar.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlatformAvatar, platformInitials } from './PlatformAvatar'

describe('platformInitials', () => {
  it('takes the first and last words', () => {
    expect(platformInitials('Portal das Finanças')).toBe('PF')
    expect(platformInitials('Segurança Social Direta')).toBe('SD')
  })

  it('takes two letters of a single word', () => {
    expect(platformInitials('bpinet')).toBe('BP')
  })

  it('copes with stray whitespace and an empty name', () => {
    expect(platformInitials('  Portal   Empresa ')).toBe('PE')
    expect(platformInitials('')).toBe('')
  })
})

describe('PlatformAvatar', () => {
  // The name is printed beside it; the initials would only repeat it.
  it('is hidden from assistive technology', () => {
    const { container } = render(<PlatformAvatar name="Portal das Finanças" />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(container).toHaveTextContent('PF')
  })
})
```

`apps/web/src/vault/CredentialsSection.test.tsx`:

1. Add imports: `waitFor, within` from `@testing-library/react`; `import { ToastProvider } from '../ui'`.
2. Replace the `Object.assign(navigator, { clipboard: … })` line with a resettable mock:

```tsx
const writeText = vi.fn()
```

and at the start of `beforeEach`:

```tsx
    writeText.mockReset().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
```

3. In `renderSection`, wrap `<CredentialsSection clientId="client1" />` in `<ToastProvider>…</ToastProvider>` (inside the `I18nextProvider`).
4. Add a helper below `renderSection`:

```tsx
async function credentialFor(item: Record<string, string>, id = 'c1') {
  const { ciphertext, iv } = await encryptCredentialItem(vaultKey, item)
  return {
    id,
    clientId: 'client1',
    platformId: 'p1',
    label: 'Acesso principal',
    updatedAt: '2026-09-10T00:00:00.000Z',
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
  }
}
```

5. In `'encrypts before creating a credential'`, open the dialog first and scope to it:

```tsx
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: /nova credencial/i }))
    const dialog = await screen.findByRole('dialog', { name: /nova credencial/i })
    await userEvent.type(within(dialog).getByLabelText(/designação/i), 'Nova')
    await userEvent.type(within(dialog).getByLabelText(/utilizador/i), 'user2')
    await userEvent.type(within(dialog).getByLabelText(/^palavra-passe$/i), 'secret2')
    await userEvent.click(within(dialog).getByRole('button', { name: /^criar$/i }))
```

(the rest of the test unchanged).

6. In `'falls back to the cached credentials and platforms …'`, replace the `portal das finanças — acesso em cache` assertion with:

```tsx
    expect(await screen.findByText('Acesso em cache', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Portal das Finanças')).toBeInTheDocument()
```

7. Append:

```tsx
  it('copies the password, says the clipboard clears, and confirms with a toast', async () => {
    listCredentialsForClientMock.mockResolvedValue([await credentialFor({ username: 'user1', password: 'hunter2' })])
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))
    expect(await screen.findByText('Limpa ao fim de 30 s')).toBeInTheDocument()
    expect(screen.queryByText('hunter2')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^copiar$/i }))

    expect(writeText).toHaveBeenCalledWith('hunter2')
    const region = screen.getByRole('region', { name: /notificações/i })
    expect(await within(region).findByText(/palavra-passe copiada/i)).toBeInTheDocument()
  })

  it('copies the username plainly, with its own toast', async () => {
    listCredentialsForClientMock.mockResolvedValue([await credentialFor({ username: 'user1', password: 'hunter2' })])
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Copiar utilizador' }))

    expect(writeText).toHaveBeenCalledWith('user1')
    const region = screen.getByRole('region', { name: /notificações/i })
    expect(await within(region).findByText('Utilizador copiado.')).toBeInTheDocument()
  })

  // Review Focus 4: plain HTTP over Tailscale has no clipboard API.
  it('shows no "copied" toast, and throws nothing, when there is no clipboard', async () => {
    Object.assign(navigator, { clipboard: undefined })
    listCredentialsForClientMock.mockResolvedValue([await credentialFor({ username: 'user1', password: 'hunter2' })])
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^copiar$/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Copiar utilizador' }))

    // Give a rejected copy the same chance to (wrongly) toast as a successful one.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const region = screen.getByRole('region', { name: /notificações/i })
    expect(within(region).queryByText(/copiad/i)).not.toBeInTheDocument()
  })

  it('shows the current code grouped, with the seconds left in its step', async () => {
    listCredentialsForClientMock.mockResolvedValue([await credentialFor({ totpSecret: 'JBSWY3DPEHPK3PXP' })])
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))

    expect(await screen.findByText(/^\d{3} \d{3}$/)).toBeInTheDocument()
    expect(screen.getByText(/^\d{1,2} s restantes$/)).toBeInTheDocument()
  })

  it('changes the password through a dialog', async () => {
    listCredentialsForClientMock.mockResolvedValue([await credentialFor({ username: 'user1', password: 'hunter2' })])
    rotateCredentialMock.mockResolvedValue({})
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /mudar palavra-passe/i }))
    const dialog = await screen.findByRole('dialog', { name: /mudar palavra-passe/i })
    await userEvent.type(within(dialog).getByLabelText(/^palavra-passe$/i), 'new secret')
    await userEvent.click(within(dialog).getByRole('button', { name: /^confirmar$/i }))

    await waitFor(() => expect(rotateCredentialMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('offers to create the first credential from the empty state', async () => {
    listCredentialsForClientMock.mockResolvedValue([])
    renderSection()

    expect(await screen.findByText(/ainda não há credenciais/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /nova credencial/i })).toHaveLength(2)
  })

  it('locks the vault from the section header', async () => {
    listCredentialsForClientMock.mockResolvedValue([])
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: /bloquear cofre/i }))

    await waitFor(() => expect(screen.queryByRole('button', { name: /nova credencial/i })).not.toBeInTheDocument())
  })
```

After locking, the gate renders in place of the list; `useSession` is unmocked in this file (as today), so the gate shows its pending skeleton — the test only needs the unlocked header actions to be gone.

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- PlatformAvatar CredentialsSection
```

Expected: FAIL — `./PlatformAvatar` does not resolve; no dialog, toasts, avatar, or header actions.

- [ ] **Step 3: Write `PlatformAvatar.tsx`**

```tsx
/** The first letters of a platform name's first and last words; two letters of a one-word name. */
export function platformInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== '')
  const first = words[0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1] ?? '') : ''
  const initials = last === '' ? first.slice(0, 2) : `${first.slice(0, 1)}${last.slice(0, 1)}`
  return initials.toUpperCase()
}

/** Shared with the Vault page. The name is always printed beside it, so it is decorative. */
export function PlatformAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-accent-50 text-xs font-semibold text-accent-700"
    >
      {platformInitials(name)}
    </span>
  )
}
```

- [ ] **Step 4: Rewrite `CredentialRow.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Copy } from 'lucide-react'
import { decryptCredentialItem, encryptCredentialItem, fromBase64, generateTotp, toBase64 } from '@ledger-hq/crypto'
import type { CredentialItem } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Button, DataList, Dialog, Input, useToast } from '../ui'
import { rotateCredential } from './api'
import type { CredentialResponse } from './api'
import { recordReveal } from './outbox'
import { PlatformAvatar } from './PlatformAvatar'
import { useVaultState } from './vault-session'

type Props = { credential: CredentialResponse; platformName: string; onRotated: () => void }

const CLIPBOARD_CLEAR_MS = 30_000
const PASSWORD_MASK = '••••••••'
const TOTP_STEP_SECONDS = 30

/** Clears the clipboard 30 seconds after copying a secret — "to the extent the browser permits" (spec 9.4). */
async function copyAndClear(value: string): Promise<void> {
  await navigator.clipboard.writeText(value)
  setTimeout(() => {
    navigator.clipboard.writeText('').catch(() => {})
  }, CLIPBOARD_CLEAR_MS)
}

/**
 * A plain copy, for a username: not a secret, so no clear. Async so a missing
 * clipboard API (plain HTTP) rejects rather than throwing synchronously.
 */
async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value)
}

function secondsLeftInStep(): number {
  return TOTP_STEP_SECONDS - (Math.floor(Date.now() / 1000) % TOTP_STEP_SECONDS)
}

export function CredentialRow({ credential, platformName, onRotated }: Props) {
  const { t, i18n } = useTranslation(['vault', 'common'])
  const { toast } = useToast()
  const vaultState = useVaultState()
  const [item, setItem] = useState<CredentialItem | null>(null)
  const [totp, setTotp] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(secondsLeftInStep)
  const [rotating, setRotating] = useState(false)
  const [newPassword, setNewPassword] = useState('')

  async function reveal(): Promise<void> {
    if (vaultState.status !== 'unlocked') return
    const decrypted = await decryptCredentialItem(vaultState.key, fromBase64(credential.ciphertext), fromBase64(credential.iv))
    setItem(decrypted as CredentialItem)
    void recordReveal(credential.id)
  }

  // Spec 9.4: "Locking releases the reference and clears cached plaintext."
  // Auto-lock (Task 10) only drops the CryptoKey — anything already
  // revealed on screen must be cleared independently, or a credential
  // stays visible past the inactivity window that was supposed to hide it.
  useEffect(() => {
    if (vaultState.status === 'locked') setItem(null)
  }, [vaultState.status])

  useEffect(() => {
    const secret = item?.totpSecret
    if (secret === undefined) {
      setTotp(null)
      return
    }

    let cancelled = false
    // One tick refreshes both the code and the seconds left in its step.
    const tick = () => {
      setSecondsLeft(secondsLeftInStep())
      generateTotp(secret).then((code) => {
        if (!cancelled) setTotp(code)
      })
    }
    tick()
    const interval = setInterval(tick, 1000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [item?.totpSecret])

  const rotateMutation = useMutation({
    mutationFn: async () => {
      if (vaultState.status !== 'unlocked' || item === null) throw new Error('vault locked')
      const { ciphertext, iv } = await encryptCredentialItem(vaultState.key, { ...item, password: newPassword })
      return rotateCredential(credential.id, { ciphertext: toBase64(ciphertext), iv: toBase64(iv) })
    },
    onSuccess: () => {
      setRotating(false)
      setNewPassword('')
      setItem(null)
      onRotated()
    },
  })

  // A copy that did not happen (no clipboard API, or a denied write) gets no
  // toast — a "copied" message for a copy that failed is worse than silence.
  function copyPassword(password: string) {
    copyAndClear(password)
      .then(() => toast({ title: t('vault:credentials.passwordCopied'), tone: 'success' }))
      .catch(() => {})
  }

  function copyUsername(username: string) {
    copyText(username)
      .then(() => toast({ title: t('vault:credentials.usernameCopied'), tone: 'success' }))
      .catch(() => {})
  }

  return (
    <li className="flex flex-col gap-4 px-5 py-3">
      <div className="flex items-center gap-4">
        <PlatformAvatar name={platformName} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{platformName}</span>
          <span className="truncate text-xs text-muted">
            {credential.label} ·{' '}
            {t('vault:credentials.changed', {
              date: formatDate(credential.updatedAt.slice(0, 10), i18n.language as SupportedLocale),
            })}
          </span>
        </div>
        {item === null ? (
          <Button variant="secondary" size="sm" onClick={() => void reveal()}>
            {t('vault:credentials.reveal')}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setItem(null)}>
            {t('vault:credentials.hide')}
          </Button>
        )}
      </div>

      {item !== null && (
        <div className="flex flex-col gap-4 md:pl-12">
          <DataList as="dl">
            {item.username !== undefined && (
              <DataList.Row
                label={t('vault:credentials.form.username.label')}
                value={
                  <>
                    <span className="truncate">{item.username}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('vault:credentials.copyUsername')}
                      onClick={() => copyUsername(item.username ?? '')}
                    >
                      <Copy aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </>
                }
              />
            )}
            {item.password !== undefined && (
              // Never rendered in clear: a mask, Copy, and the clear stated where it happens.
              <DataList.Row
                label={t('vault:credentials.form.password.label')}
                value={
                  <>
                    <span className="font-mono">{PASSWORD_MASK}</span>
                    <Button variant="secondary" size="sm" onClick={() => copyPassword(item.password ?? '')}>
                      {t('vault:credentials.copy')}
                    </Button>
                    <span className="text-xs text-muted">{t('vault:credentials.clipboardClears')}</span>
                  </>
                }
              />
            )}
            {totp !== null && (
              // Not a live region: announcing every second would make the page
              // unusable with a screen reader (spec §10.4).
              <DataList.Row
                label={t('vault:credentials.totp')}
                value={
                  <>
                    <span className="font-mono text-lg tabular-nums">{`${totp.slice(0, 3)} ${totp.slice(3)}`}</span>
                    <span className="text-xs text-muted tabular-nums">
                      {t('vault:credentials.secondsLeft', { seconds: secondsLeft })}
                    </span>
                  </>
                }
              />
            )}
          </DataList>
          {item.notes !== undefined && <p className="whitespace-pre-line text-sm font-normal">{item.notes}</p>}
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setRotating(true)}>
            {t('vault:credentials.rotate')}
          </Button>
        </div>
      )}

      <Dialog
        open={rotating}
        onOpenChange={(open) => {
          setRotating(open)
          if (!open) setNewPassword('')
        }}
      >
        <Dialog.Content title={t('vault:credentials.rotate')} size="sm">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (newPassword === '') return
              rotateMutation.mutate()
            }}
          >
            <Input
              type="password"
              autoComplete="new-password"
              required
              label={t('vault:credentials.form.password.label')}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <ErrorMessage error={rotateMutation.error} />
            <Dialog.Footer>
              <Dialog.Close asChild>
                <Button variant="ghost">{t('common:actions.cancel')}</Button>
              </Dialog.Close>
              <Button variant="primary" type="submit" isLoading={rotateMutation.isPending} disabled={newPassword === ''}>
                {t('vault:credentials.rotateConfirm')}
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      </Dialog>
    </li>
  )
}
```

- [ ] **Step 5: Rewrite `AddCredentialForm.tsx`**

Keep the mutation exactly as it is, but replace its `onSuccess` body with `onCreated()` (the dialog unmounts the form, which resets it). Replace the rendered form:

```tsx
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <Select
        label={t('vault:credentials.form.platform.label')}
        value={platformId}
        onChange={(event) => setPlatformId(event.target.value)}
      >
        {platforms.map((platform) => (
          <option key={platform.id} value={platform.id}>
            {platform.name}
          </option>
        ))}
      </Select>
      <Input required label={t('vault:credentials.form.label.label')} value={label} onChange={(event) => setLabel(event.target.value)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          autoComplete="off"
          label={t('vault:credentials.form.username.label')}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <Input
          type="password"
          autoComplete="new-password"
          label={t('vault:credentials.form.password.label')}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <Input
        autoComplete="off"
        spellCheck={false}
        label={t('vault:credentials.form.totpSecret.label')}
        value={totpSecret}
        onChange={(event) => setTotpSecret(event.target.value)}
        className="font-mono"
      />

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
```

Delete the `<h3>` (the dialog's title replaces it) and the `if (platforms.length === 0) return null` line (the section handles no platforms). Add `import { Button, Dialog, Input, Select } from '../ui'`, and add a one-line doc comment above the component: `/** Renders inside the New credential dialog; encrypts on this device before anything is sent. */`

- [ ] **Step 6: Rewrite `CredentialsSection.tsx`**

```tsx
import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { KeyRound, Lock, Plus } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Card, Dialog, EmptyState, Skeleton } from '../ui'
import { listCredentialsForClient, listPlatforms } from './api'
import type { PlatformResponse } from './api'
import { AddCredentialForm } from './AddCredentialForm'
import { CredentialRow } from './CredentialRow'
import { listCachedCredentials, listCachedPlatforms } from './vault-db'
import { VaultUnlockGate } from './VaultUnlockGate'
import { lockVault, useVaultState } from './vault-session'

/** The gate or the list, never both. The header's actions exist only once unlocked. */
export function CredentialsSection({ clientId }: { clientId: string }) {
  const { t } = useTranslation(['vault', 'common'])
  const titleId = useId()
  const vaultState = useVaultState()
  const [creating, setCreating] = useState(false)

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id={titleId} className="text-base font-semibold">
          {t('vault:credentials.title')}
        </h2>
        {vaultState.status === 'unlocked' && (
          <div className="flex items-center gap-2">
            {/* The account menu's own action, closer to where the secrets are. */}
            <Button variant="ghost" size="sm" onClick={() => lockVault()}>
              <Lock aria-hidden="true" className="h-3.5 w-3.5" />
              {t('common:actions.lockVault')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              {t('vault:credentials.newTitle')}
            </Button>
          </div>
        )}
      </div>
      <VaultUnlockGate>
        <CredentialsList clientId={clientId} creating={creating} onCreatingChange={setCreating} />
      </VaultUnlockGate>
    </section>
  )
}

type ListProps = { clientId: string; creating: boolean; onCreatingChange: (open: boolean) => void }

function CredentialsList({ clientId, creating, onCreatingChange }: ListProps) {
  const { t } = useTranslation('vault')
  const queryClient = useQueryClient()

  const credentials = useQuery({
    queryKey: ['credentials', clientId],
    // Falls back to the durable IndexedDB cache (Task 11) when the network
    // is unreachable, the same catch-based shape `resolveEnvelope` already
    // uses for the vault envelope — offline reads must not depend solely on
    // the generic HTTP cache's 24-hour window.
    queryFn: async () => {
      try {
        return await listCredentialsForClient(clientId)
      } catch {
        return listCachedCredentials(clientId)
      }
    },
  })
  const platforms = useQuery({
    queryKey: ['platforms'],
    queryFn: async () => {
      try {
        return await listPlatforms()
      } catch {
        return (await listCachedPlatforms()) as PlatformResponse[]
      }
    },
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['credentials', clientId] })

  function platformName(platformId: string): string {
    return platforms.data?.find((platform) => platform.id === platformId)?.name ?? platformId
  }

  return (
    <>
      {credentials.isPending || platforms.isPending ? (
        <Card padding="none" className="flex flex-col px-5" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex min-h-[56px] items-center gap-4 border-b border-line py-3 last:border-b-0">
              <Skeleton width="2rem" height="2rem" />
              <Skeleton width="12rem" height="0.875rem" />
            </div>
          ))}
        </Card>
      ) : credentials.isError ? (
        <ErrorMessage error={credentials.error} />
      ) : credentials.data.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={t('credentials.empty')}
          action={
            <Button variant="primary" onClick={() => onCreatingChange(true)}>
              {t('credentials.newTitle')}
            </Button>
          }
        />
      ) : (
        <Card padding="none">
          <ul className="flex flex-col divide-y divide-line">
            {credentials.data.map((credential) => (
              <CredentialRow
                key={credential.id}
                credential={credential}
                platformName={platformName(credential.platformId)}
                onRotated={() => void invalidate()}
              />
            ))}
          </ul>
        </Card>
      )}

      <Dialog open={creating} onOpenChange={onCreatingChange}>
        <Dialog.Content title={t('credentials.newTitle')}>
          {platforms.data === undefined || platforms.data.length === 0 ? (
            <p className="text-sm text-muted">{t('platforms.empty')}</p>
          ) : (
            <AddCredentialForm
              clientId={clientId}
              platforms={platforms.data}
              onCreated={() => {
                onCreatingChange(false)
                void invalidate()
              }}
            />
          )}
        </Dialog.Content>
      </Dialog>
    </>
  )
}
```

- [ ] **Step 7: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- PlatformAvatar CredentialsSection VaultUnlockGate ClientDetailPage
pnpm --filter @ledger-hq/web test
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: PASS — 4 `PlatformAvatar` tests, 11 `CredentialsSection` tests, and the whole suite.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/vault
git commit -m "feat(web): restyle the Credentials tab with toasts and dialogs" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: End-to-end, the guidelines, and the definition of done

**Files:**
- Modify: `apps/web/e2e/setup-and-clients.spec.ts`, `apps/web/e2e/obligations.spec.ts`, `apps/web/e2e/billing.spec.ts`, `apps/web/e2e/search-and-reporting.spec.ts`, `apps/web/e2e/vault-offline.spec.ts`
- Modify: `docs/design/guidelines.md`
- Modify: `docs/design/roadmap.md`

**Interfaces:**
- Consumes: everything above. The e2e files as Stage 2 left them (its Task 12 changed every client-creation submit to `/^criar$/i` and every Create link to `.first()`).
- Produces: the stage's definition of done.

Four things changed for every spec that drives the client page, and each edit below is one of them:

1. **The client page has its own "Clientes" back link**, so `page.getByRole('link', { name: /clientes/i })` matches two visible links there (the nav's and the header's) and Playwright's strict mode refuses it. Scope to the nav.
2. **The fiscal profile is a card on Overview**: "Preencher" opens its dialog; "Guardar" is inside it.
3. **Each section is on its own tab**, and **every form is a dialog** — scope to `page.getByRole('dialog', { name })`. Radix marks everything behind a modal `aria-hidden`, so page-level queries no longer see the page under it.
4. **Amounts are typed in euros**, and the amount fields are labelled "Valor" / "Valor mensal".

- [ ] **Step 1: Scope every nav click to the nav**

In all five files, replace every `page.getByRole('link', { name: /clientes/i })` with `page.getByRole('navigation').getByRole('link', { name: /clientes/i })`. (`getByRole` skips hidden elements, so at any viewport this resolves to the one visible nav — the sidebar on a desktop, the tab bar on a phone.)

```bash
cd /Users/pauloaraujo/Projects/personal/ledger-hq/apps/web
sed -i '' "s#page.getByRole('link', { name: /clientes/i })#page.getByRole('navigation').getByRole('link', { name: /clientes/i })#g" \
  e2e/setup-and-clients.spec.ts e2e/obligations.spec.ts e2e/billing.spec.ts e2e/search-and-reporting.spec.ts e2e/vault-offline.spec.ts
grep -c "getByRole('navigation').getByRole('link', { name: /clientes/i })" e2e/*.spec.ts
```

(On Linux, `sed -i` without the `''`.)

- [ ] **Step 2: Replace every "fiscal profile defaults" click**

Every line of the form `await page.getByRole('button', { name: /guardar/i }).click() // fiscal profile defaults…` (or `// saves the fiscal profile's own defaults…`) — in `obligations.spec.ts` (two), `billing.spec.ts` (two) and `search-and-reporting.spec.ts` (one) — becomes:

```ts
  // The fiscal profile is a card on the Overview tab; "Preencher" opens it
  // with the kind's defaults, which already imply COMPANY/MONTHLY.
  await page.getByRole('button', { name: /^preencher$/i }).click()
  await page.getByRole('dialog', { name: /perfil fiscal/i }).getByRole('button', { name: /^guardar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
```

- [ ] **Step 3: `obligations.spec.ts`**

In the first test, insert before the `// The regenerate preview banner …` comment:

```ts
  // The generator preview lives on the Obligations tab.
  await page.getByRole('tab', { name: /obrigações/i }).click()
```

and replace everything from `// Back on the client page, adjust a different obligation's due date.` to the end of the test with:

```ts
  // Back on the client page, adjust a different obligation's due date.
  await page.getByRole('navigation').getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: 'Padaria Central Obrigações, Lda.' }).click()
  await page.getByRole('tab', { name: /obrigações/i }).click()

  // Scoped to the section, then to the dialog Edit opens: the adjust form is
  // the only thing on screen once it is open.
  const obligations = page.getByRole('region', { name: /obrigações fiscais/i })
  await obligations.getByRole('button', { name: /^editar$/i }).first().click()
  const adjust = page.getByRole('dialog')
  await adjust.getByLabel(/prazo/i).fill('2026-12-31')
  await adjust.getByRole('button', { name: /^guardar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // The saved row renders the date through `formatDate` (b0f5b17), so the
  // assertion is on the pt-PT rendering, not on the ISO value typed above.
  await expect(obligations.getByText('31/12/2026')).toBeVisible()
})
```

In the second test, insert the same two-line tab click before `const obligations = page.getByRole('region', …)`, and replace

```ts
  const panel = page.getByRole('region', { name: /comprovativos/i })
```

with

```ts
  const panel = page.getByRole('dialog', { name: /comprovativos/i })
```

After `page.reload()` the URL still carries `?tab=obligations`, so the reloaded page opens on the same tab — the following `obligations.getByRole('button', { name: /^comprovativos$/i })` needs no change.

- [ ] **Step 4: `billing.spec.ts`, first test**

Replace everything from the line after the Step 2 fiscal-profile block down to (not including) `// And the charge being fully allocated clears the client from receivables.` with:

```ts
  // Billing is its own tab, and every form on it opens in a dialog, so each
  // locator below is scoped to the dialog it belongs to — the ambiguity
  // Phase 2 had to unpick twice (two open forms both labelled "Valor") cannot
  // arise any more.
  await page.getByRole('tab', { name: /faturação/i }).click()
  const ledger = page.getByRole('region', { name: /^faturação$/i })

  // Create the retainer plan from its card. Amounts are typed in euros.
  await ledger.getByRole('button', { name: /criar plano de retainer/i }).click()
  const planDialog = page.getByRole('dialog', { name: /criar plano de retainer/i })
  await planDialog.getByLabel(/valor mensal/i).fill('90,00')
  await planDialog.getByLabel(/dia de vencimento/i).fill('8')
  await planDialog.getByLabel(/em vigor desde/i).fill('2026-01-01')
  await planDialog.getByRole('button', { name: /^guardar$/i }).click()

  // The card now offers to update the fee instead of creating a plan —
  // which proves the plan persisted server-side, not merely that the dialog
  // closed.
  await expect(ledger.getByRole('button', { name: /atualizar valor/i })).toBeVisible()
  await expect(ledger.getByRole('button', { name: /criar plano de retainer/i })).toHaveCount(0)

  // The plan itself only produces charges when the daily generation runs
  // (BillingCron, 3AM) — there is no per-client "generate now" control in
  // the UI, so this spec raises the charge it then pays through the ad-hoc
  // route, which lands the same Charge row the generator would and drives
  // the identical propose/confirm allocation path.
  await ledger.getByRole('button', { name: /nova cobrança avulsa/i }).click()
  const chargeDialog = page.getByRole('dialog', { name: /nova cobrança avulsa/i })
  await chargeDialog.getByLabel(/descrição/i).fill('Consultoria extra')
  await chargeDialog.getByLabel(/^valor$/i).fill('150,00')
  // Dated in the past on purpose: receivables is an ageing list of charges
  // that are already due, so a future-dated charge would (correctly) not
  // appear there and the assertion below would prove nothing.
  await chargeDialog.getByLabel(/data de vencimento/i).fill('2026-09-01')
  await chargeDialog.getByRole('button', { name: /^criar$/i }).click()
  await expect(ledger.getByText(/consultoria extra/i)).toBeVisible()

  // Unpaid, the client is on the home page's receivables list.
  const receivables = page.locator('section').filter({ has: page.getByRole('heading', { name: /recebíveis/i }) })
  await page.goto('/')
  await expect(receivables.getByText(/padaria central faturação/i)).toBeVisible()

  // A receivable links straight to its client's Billing tab.
  await receivables.getByRole('link', { name: /padaria central faturação/i }).click()
  await expect(page).toHaveURL(/\?tab=billing/)

  // Record a payment covering the charge in full.
  await ledger.getByRole('button', { name: /registar pagamento/i }).click()
  const payment = page.getByRole('dialog', { name: /registar pagamento/i })
  await payment.getByLabel(/^valor$/i).fill('150,00')
  await payment.getByLabel(/data de receção/i).fill('2026-09-05')
  await payment.getByRole('button', { name: /propor alocação/i }).click()

  // The proposal is the single open charge, for the full amount.
  await expect(payment.getByText(/consultoria extra/i)).toBeVisible()
  await expect(payment.getByText(/150,00/)).toBeVisible()
  await payment.getByRole('button', { name: /^confirmar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The ledger now carries both sides of the movement.
  await expect(ledger.getByText(/pagamento — transfer/i)).toBeVisible()
  await expect(ledger.getByText(/consultoria extra/i)).toBeVisible()

```

- [ ] **Step 5: `billing.spec.ts`, second test**

Replace everything from the line after the Step 2 fiscal-profile block to the end of the test with:

```ts
  await page.getByRole('tab', { name: /faturação/i }).click()
  const ledger = page.getByRole('region', { name: /^faturação$/i })
  const credit = ledger.getByRole('region', { name: /crédito disponível/i })

  // A payment with nothing to settle: every cent becomes credit.
  await ledger.getByRole('button', { name: /registar pagamento/i }).click()
  const payment = page.getByRole('dialog', { name: /registar pagamento/i })
  await payment.getByLabel(/^valor$/i).fill('270,00')
  await payment.getByLabel(/data de receção/i).fill('2026-01-05')
  await payment.getByRole('button', { name: /propor alocação/i }).click()
  await payment.getByRole('button', { name: /^confirmar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await expect(credit.getByText(/crédito disponível/i)).toBeVisible()

  // Now give it something to settle, due in the past so it has fallen due.
  await ledger.getByRole('button', { name: /nova cobrança avulsa/i }).click()
  const chargeDialog = page.getByRole('dialog', { name: /nova cobrança avulsa/i })
  await chargeDialog.getByLabel(/descrição/i).fill('Trabalho extra')
  await chargeDialog.getByLabel(/^valor$/i).fill('90,00')
  await chargeDialog.getByLabel(/data de vencimento/i).fill('2026-02-28')
  await chargeDialog.getByRole('button', { name: /^criar$/i }).click()
  await expect(ledger.getByText(/trabalho extra/i)).toBeVisible()
```

then keep the long comment block that begins `// \`getReceivables\` nets credit against debt notionally` unchanged, followed by:

```ts
  const availableCredit = credit.locator('.tabular-nums').first()
  const creditBeforeCents = await readMoneyCents(availableCredit)
  expect(creditBeforeCents).toBe(27000)

  // "Aplicar crédito" proposes first, in a dialog; nothing is written until Confirm.
  await credit.getByRole('button', { name: /aplicar crédito/i }).click()
  const creditDialog = page.getByRole('dialog', { name: /crédito disponível/i })
  await expect(creditDialog.getByText(/trabalho extra/i)).toBeVisible()
  await creditDialog.getByRole('button', { name: /^confirmar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
```

and keep everything from `// The confirm mutation's own success handler re-fetches the ledger` to the end of the test unchanged.

- [ ] **Step 6: `search-and-reporting.spec.ts`, second test**

After the Step 2 fiscal-profile block, insert the Obligations tab click before the `// Saving the profile only proposes a regeneration …` comment:

```ts
  await page.getByRole('tab', { name: /obrigações/i }).click()
```

and replace the block from `const ledger = page.getByRole('region', { name: /^faturação$/i })` through the `adHocCharge.getByRole('button', { name: /^criar$/i }).click()` line (and its comment) with:

```ts
  await page.getByRole('tab', { name: /faturação/i }).click()
  await page.getByRole('button', { name: /nova cobrança avulsa/i }).click()
  const chargeDialog = page.getByRole('dialog', { name: /nova cobrança avulsa/i })
  await chargeDialog.getByLabel(/descrição/i).fill('Trabalho extra')
  await chargeDialog.getByLabel(/^valor$/i).fill('200,00')
  await chargeDialog.getByLabel(/data de vencimento/i).fill('2026-02-28')
  await chargeDialog.getByRole('button', { name: /^criar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
```

- [ ] **Step 7: `vault-offline.spec.ts`**

Before `await page.getByRole('link', { name: /configurar agora/i }).click()`, insert:

```ts
  // The vault prompt lives on the client's Credentials tab.
  await page.getByRole('tab', { name: /credenciais/i }).click()
```

Replace the block from `// Add a credential on the client's page.` through `await expect(page.getByText(/portal das finanças — acesso principal/i)).toBeVisible()` (including the comments between) with:

```ts
  // Add a credential on the client's page. The vault is already unlocked
  // from the setup flow above, in the same browser session.
  await page.getByRole('navigation').getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: 'Padaria Central Vault, Lda.' }).click()
  await page.getByRole('tab', { name: /credenciais/i }).click()
  // The form opens in its own dialog, so nothing else on the page — the
  // obligations tab's own "Designação" field included — can collide with it.
  await page.getByRole('button', { name: /nova credencial/i }).click()
  const credentialForm = page.getByRole('dialog', { name: /nova credencial/i })
  await credentialForm.getByLabel(/designação/i).fill('Acesso principal')
  await credentialForm.getByLabel(/utilizador/i).fill('509123456')
  await credentialForm.getByLabel(/^palavra-passe$/i).fill('correct horse battery staple')
  await credentialForm.getByRole('button', { name: /^criar$/i }).click()
  // The row shows the platform and the label on separate lines now.
  await expect(page.getByText('Acesso principal', { exact: false })).toBeVisible()
```

Leave the `// Add a platform.` block as it is — Stage 4's plan replaces it by its exact first and last lines. After `page.reload()` the URL still carries `?tab=credentials`, so the gate is on screen for the offline unlock that follows.

- [ ] **Step 8: `setup-and-clients.spec.ts` — People tab, and the phone-width page**

Replace the block from `// Link them from the company page.` through `await expect(page.getByText(/em vigor/i)).toBeVisible()` (including the comment about the ambiguous `getByText('Maria Santos')`) with:

```ts
  // Link them from the company page's People tab, through its dialog.
  await page.getByRole('navigation').getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: 'Padaria Central, Lda.' }).click()
  await page.getByRole('tab', { name: /empregados/i }).click()
  await page.getByRole('button', { name: /adicionar vínculo/i }).click()
  const employment = page.getByRole('dialog', { name: /adicionar vínculo/i })
  await employment.getByLabel(/pessoa/i).selectOption({ label: 'Maria Santos' })
  await employment.getByLabel(/data de admissão/i).fill('2024-01-15')
  await employment.getByRole('button', { name: /adicionar vínculo/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The employment row renders the counterparty's name as a link
  // (EmploymentSection.tsx), which is what proves the row appeared.
  await expect(page.getByRole('link', { name: 'Maria Santos' })).toBeVisible()
  await expect(page.getByText(/em vigor/i)).toBeVisible()
```

Stage 2's edit journey that follows needs no change: Edit is in the client header on every tab, and saving returns to the client on Overview, where the phone is in Details.

At the end of the same test — after Stage 2's phone-width list check (`expect(taxIdBox?.y ?? 0).toBeGreaterThan(nameBox?.y ?? 0)`) — append:

```ts
  // At phone width the client page keeps one row of tabs that scrolls
  // sideways rather than wrapping, and the header's actions move into a menu.
  await nameLink.click()
  const tabStrip = page.getByRole('tablist')
  await expect(tabStrip).toBeVisible()
  expect(await tabStrip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  await page.getByRole('button', { name: /ações do cliente/i }).click()
  await expect(page.getByRole('menuitem', { name: /^editar$/i })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /^arquivar$/i })).toBeVisible()
```

- [ ] **Step 9: Run the end-to-end suite**

```bash
pnpm --filter @ledger-hq/web test:e2e
```

Expected: PASS. A failure in a step this task did not touch belongs to an earlier phase's flow — check it against what that phase shipped before changing anything.

- [ ] **Step 10: Extend `docs/design/guidelines.md`**

In §2 "Which component for which job", after the "A page title" paragraph, add:

```markdown
**A form** — in a `Dialog` when it is launched from a row, has more than
one step, or creates something; on the client page, that is every form.
No form is permanently rendered under a list. The section that owns the
button owns the dialog's `open` state; a successful submit closes it, a
failed one keeps it open with the `ErrorMessage` inside. The form renders
its own `<form>` and ends in a `Dialog.Footer` — Cancel
(`Dialog.Close asChild` + a ghost `Button`) first, the primary action last.
The dialog's `title` replaces the form's own heading. **One dialog at a
time**: a dialog never opens another; confirm in place instead (the
receipts dialog's "Delete for good").

**Tabs** — `Tabs`, always controlled, with the value in the URL
(`?tab=`, validated by the route, absent means the first tab) and changed
with `replace: true`, so Back leaves the page rather than walking the
tabs. An inactive panel is unmounted, so its queries do not run; a
summary that needs another tab's data fetches it under that tab's own
query key.

**A confirmation with no other visible result** — a toast, through
`useToast()`; in practice, a copy to the clipboard. A dialog that closes
and a list that updates is its own confirmation. A toast never carries the
only copy of anything, and a copy that failed gets no toast.

**A message about a section's state** — `Callout`, when it is neither an
error nor empty and there may be content below it: the generator preview,
the vault not set up, the vault unknown offline. `EmptyState` is for a list
with nothing in it; `ErrorMessage` is for a request that failed. `role` on
a `Callout` only when the message must be announced as it appears.

**An amount typed by a person** — `MoneyInput`, which shows euros in the
locale's notation and hands the form integer cents. `parseAmount` (text to
cents) and `formatCurrency`/`formatAmount` (cents to text) in
`i18n/format.ts` are the only conversions. A grouping separator is
accepted only between groups of three digits, so a decimal typed with the
wrong mark is refused rather than read as a hundredfold amount. Whether an
amount must be positive is the form's rule.

**Name/value descriptions** — `DataList as="dl"`. Lists of records stay
`div`.
```

Append to the accessibility checklist (after the items Stage 2 added):

```markdown
15. Tabs move with the arrow keys and Home/End; a badge inside a tab is
    part of its name.
16. A dialog has a title, takes focus to its first field on open, traps
    it, and returns it to what opened it on close; Escape closes it.
17. A countdown (the TOTP's seconds left) is never a live region.
18. An amount's format error is announced like any field error, and only
    once the field is left.
```

- [ ] **Step 11: Mark Stage 3 shipped in `docs/design/roadmap.md`**

Under `## Stage 3 — Client detail page`, change `**Status:** specced.` to `**Status:** shipped.`, and add after its `[Spec]` line:

```markdown
- [Plan](../superpowers/plans/2026-10-04-ui-refresh-stage-3.md).
```

- [ ] **Step 12: Run the whole definition of done**

```bash
cd /Users/pauloaraujo/Projects/personal/ledger-hq
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @ledger-hq/web i18n:check
pnpm --filter @ledger-hq/web test:e2e
```

Expected: all PASS. Then compare the browser at 1280×800 and 390×844 against the boards from Task 1 — every tab, the skeleton, the empty states, each dialog, the gate, a revealed credential with the copy toast, and the home page's obligation rows. A mismatch is raised with the human partner, not silently resolved in either direction.

- [ ] **Step 13: Commit**

```bash
git add apps/web/e2e docs/design/guidelines.md docs/design/roadmap.md
git commit -m "test(web): drive the tabbed client page end to end, and document dialogs, tabs and amounts" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review against the spec

- §1 Ships — `Tabs` (Task 6), `Dialog` (5), `Toast` (7), `Callout` (4), `MoneyInput` (8), `DataList as="dl"` (4); the page as header + five URL-backed tabs (9, 12); all seventeen components restyled: `FiscalProfileForm` (10), `ObligationsSection`, `AdjustObligationForm`, `AddAdHocObligationForm` (14), `ObligationRow` (13), `ObligationAttachments` (15), `ClientLedgerSection`, `RecordPaymentForm`, `AddAdHocChargeForm` (17), `RetainerPlanForm`, `ApplyCreditForm` (16), `EmploymentSection`, `AddEmploymentForm` (18), `VaultUnlockGate` (19), `CredentialsSection`, `CredentialRow`, `AddCredentialForm` (20); amounts in euros in all four forms (16, 17); i18n (2, 15-17); guidelines (21). Does-not-ship: no task touches the Vault page, vault setup, auth screens, or any API.
- §2 Decisions — 1 every form a dialog (10, 14-20); 2 euros (3, 8, 16, 17); 3 tab in the URL with `replace` (9, 12); 4 Overview fetches its summary's keys (11) and the badge reads the cache (12); 5 only "written off" badged (17); 6 inline attachment-delete confirmation (15).
- §3 Boards — Task 1, including the 5-minute copy and the dropped ledger badges; compared in Task 21.
- §4 Dependencies — Task 2 Step 2, with the peer check.
- §5.1-5.6 — Tasks 6, 5, 7, 4, 8, 4.
- §6.1-6.5 — file structure as listed; route (9); header incl. mobile menu and errors (12); tab strip adornments — overdue badge, lock icon, People label (12); skeleton and error (12).
- §7.1 — Details, fiscal profile card and dialog, At a glance (10, 11). §7.2 — section, preview callout, adjust and new dialogs, receipts (13-15). §7.3 — ledger, write-off dialog, plan, ageing and credit cards, payment and charge dialogs, invalidations unchanged (16, 17). §7.4 — Task 18. §7.5 — gate (19), header actions, rows, avatar, toasts, TOTP countdown, rotate dialog, empty state (20).
- §8 File layout — as listed. **Additions:** `clientTabs.test.ts`, `Callout.test.tsx`, `PlatformAvatar.test.tsx`, `ledgerCards.test.tsx` (each a new unit's own test), and `ClientOverviewTab.test.tsx`.
- §9 i18n — Task 2 (new keys, *tu* and *bloquear*), Task 15 (two removals), Tasks 16-17 (four label changes). `common:notifications` is the spec's addition from planning.
- §10 Accessibility 1-5 — Tabs test (6), Dialog tests (5), toast only after a successful copy (20), TOTP not live (20, comment), MoneyInput error on blur (8).
- §11 Testing — every listed test is in Tasks 3-20; `HomePage.test.tsx` and `ObligationsDashboard.test.tsx` pass unchanged (13); e2e in Task 21. **Addition:** `search-and-reporting.spec.ts` drives the fiscal profile, Obligations and Billing tabs too, and every spec's nav click is scoped to the nav (Task 21 Step 1) — the spec did not list either.
- §12 Risks — a commit per component, then the page, then one tab at a time, each green; tests that found inline forms now open their dialog first; `MoneyInput` reformats on blur and the proposal shows the amount before Confirm; the Overview board is redrawn with the row (1); `ToastProvider` in `AppLayout` (7).
- §13 Guidelines — Task 21 Step 10.
