# UI refresh, Stage 5 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take sign-in, vault recovery and first-run account setup out of the app shell into a standalone, centred auth layout built on Stage 2's form controls, with a splash instead of a blank screen and a recovery-code field that accepts the code however it is typed.

**Architecture:** The session gate (`RequireSession`) moves from inside `AppLayout`'s `<main>` to above the whole shell: the root route renders `RequireSession`, which shows `AuthSplash`, `AuthLayout` + `SetupPage`, `AuthLayout` + `LoginPage`, or — signed in — `AppLayout`. No route path changes. The language control is extracted from `AccountMenu` into `shell/LanguageMenu.tsx` (`LanguageMenu` for the auth corner, `LanguageRadioItems` shared with the account menu). Recovery-code normalisation is a pure module beside `vault/recover.ts`.

**Tech Stack:** React 19.2, TypeScript, Tailwind CSS v4 (CSS-first tokens in `styles.css`), TanStack Router and Query, i18next, Radix Dropdown Menu, `lucide-react`, Vitest + Testing Library (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-ui-refresh-stage-5-design.md` — read it in full before Task 1. Form-control APIs come from `docs/superpowers/specs/2026-10-04-ui-refresh-stage-2-design.md` §5; the `ToastProvider` in `AppLayout` comes from `docs/superpowers/specs/2026-10-04-ui-refresh-stage-3-design.md` §5.3. Screens: <https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92>.

## Global Constraints

- **Starts after Stages 2, 3 and 4 are merged.** This plan uses Stage 2's `Input` (props `label`, `hideLabel?`, `hint?`, `error?`, `leadingIcon?`, every native `<input>` prop; `className` lands on the `<input>`; the ref is forwarded to the `<input>`; a field error renders with `role="alert"` and is linked by `aria-describedby`, with `aria-invalid="true"` on the control) and Stage 3's `ToastProvider` wrapping `AppLayout`. Task 2's first step checks both exist; if either is missing, stop.
- **No route path changes, no API changes, no new auth behaviour** (no password visibility toggle, no "remember me").
- **No hardcoded user-visible strings**, including every `aria-label`. `pnpm --filter @ledger-hq/web i18n:check` compares the two bundles; `src/i18n/locales/locales.test.ts` does the same in the unit suite.
- **Portuguese copy is informal (`tu`).** Every existing `pt-PT` string addresses the user as `tu` ("Configura a tua conta", "Esqueceste a palavra-passe mestra?", "Tenta outra vez"). The spec's §7 table uses the same register (spec §2.5); the copy is shown in full in Tasks 6 and 7, and the English copy is the spec's verbatim.
- **Tests assert Portuguese.** Every web test calls `await initI18n()` then `await i18next.changeLanguage('pt-PT')`, because jsdom reports `en-US`. Follow it.
- **Named exports only**; no default exports.
- **Type scale is closed:** `text-2xl` page title, `text-lg`/`text-base` section headings, `text-sm` body, `text-xs` captions (`docs/design/guidelines.md` §1). The card's `<h1>` is `text-2xl` — the card heading is the page's title (spec §4.2).
- **Components set no margin on themselves**; spacing is the parent's (`gap-*`).
- `tsconfig` has `exactOptionalPropertyTypes`. Stage 2 types every optional `FieldProps` member as `| undefined` (`error?: string | undefined`), so `error={cond ? msg : undefined}` compiles on `Input`, and this plan passes field errors that way. A prop typed plainly `x?: T` (no `| undefined`) still needs a conditional spread, `{...(cond ? { x: value } : {})}`.
- `MIN_MASTER_PASSWORD_LENGTH` is `12` (`packages/crypto/src/params.ts`); never hardcode 12 in code, only in test regexes.
- **Commit after every task** with a `feat(web):`, `refactor(web):`, `test(web):` or `docs:` prefix, ending with the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

Five inputs no happy-path test would exercise, most likely first. Each has a test in the task that owns the code.

1. **A recovery code pasted with extra spacing or separators**, e.g. `" abcde  fghij  klmno  pqrst  uvwxy  z "` (38 characters). A `maxLength` would truncate it *before* normalisation and submit a wrong code; the formatter already caps at 26 code characters, so the field gets **no** `maxLength` (spec §5.4). Expected: the field shows `ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z`. → Task 2 (formatter) and Task 6 (paste into the field).
2. **Typing in the middle of a half-typed code.** Re-grouping moves characters across hyphens; if the caret is not restored, the next keystroke lands at the end and scrambles the code. Expected: inserting `K` after `ABC` in `ABCDE-FGHIJ`, then `L`, gives `ABCKL-DEFGH-IJ`. → Task 2 (caret helpers) and Task 6.
3. **The network is down on first load** — both `/auth/bootstrap-required` and `/auth/session` reject with a `TypeError`. Expected: the sign-in card, not the splash forever. → Task 5.
4. **Signing out** must remove the whole shell (both nav landmarks, the search box, the account menu), not just swap the main content. → Task 5.
5. **Changing language on the setup screen** must change the locale the account is created with — the reason the language menu is in the auth layout at all. Expected: `createAccount(…, 'en-GB')` after choosing English. → Task 7.

---

## File Structure

```
apps/web/src/
  vault/
    recoveryCode.ts          (new) formatRecoveryCode, significantBefore, caretInFormatted — Task 2
    recoveryCode.test.ts     (new) — Task 2
  shell/
    LanguageMenu.tsx         (new) LanguageMenu, LanguageRadioItems — Task 3
    LanguageMenu.test.tsx    (new) — Task 3
    AccountMenu.tsx          uses LanguageRadioItems (Task 3); signed-out branch removed (Task 5)
    AccountMenu.test.tsx     signed-out cases deleted — Task 5
    AppLayout.tsx            no longer gates — Task 5
    AppLayout.test.tsx       renders through RequireSession — Task 5
  auth/
    AuthLayout.tsx           (new) AuthFrame, AuthMark, AuthLayout — Task 4
    AuthSplash.tsx           (new) — Task 4
    AuthLayout.test.tsx      (new) — Task 4
    RequireSession.tsx       (new, moved from router.tsx) — Task 5
    RequireSession.test.tsx  (new) — Task 5
    LoginPage.tsx            restyled, recovery normalisation — Task 6
    LoginPage.test.tsx       — Task 6
    SetupPage.tsx            restyled — Task 7
    SetupPage.test.tsx       — Task 7
  router.tsx                 root component becomes Root — Task 5
  i18n/locales/{pt,en}/common.json   common:loading (Task 4), auth.* (Tasks 6, 7)
apps/web/e2e/
  setup-and-clients.spec.ts  language test no longer expects a signed-out nav — Task 5
  shell.spec.ts              signed-out checks at both viewports — Task 8
docs/design/guidelines.md    auth section, closing pass — Task 8
docs/design/roadmap.md       Auth row in the mockups table (Task 1); Stage 5 shipped (Task 8)
```

`AuthFrame` exists so `AuthSplash` and `AuthLayout` share one frame and the mark sits in exactly the same place in both — the spec's "a static mark that the sign-in card or the shell then replaces reads as one continuous screen".

---

### Task 1: Draw the auth boards

**Files:**
- Modify (canvas): <https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92> — eight new artboards and one note
- Modify: `docs/design/roadmap.md` (the Mockups table)

**Interfaces:**
- Consumes: the canvas's existing tokens and field styling (`project/ClientForm.dc.html`, `project/Components.dc.html`).
- Produces: the boards Tasks 4, 6 and 7 are checked against at the end (Task 8). Once drawn, the boards outrank the spec's prose where they disagree (spec §3).

No code. The spec (§3) makes drawing the first task because no auth board exists.

- [ ] **Step 1: Read the canvas and its type instructions**

Use the Artifact tool: `action: "read"` on the canvas URL. Its reply carries the Design type's instructions — follow them exactly for file shapes and the publish call. Stages 2-4 have added boards since the canvas was first drawn, so `list` it with `scope: "files"` before assuming any layout. Then read `project/canvas.json`, `project/ClientForm.dc.html` (input, label, error and button styling), `project/Mobile.dc.html` (mobile frame conventions) and `project/Components.dc.html` (badges, buttons).

- [ ] **Step 2: Write eight artboards**

Save each under one scratch folder at `project/<Name>.dc.html`, copying the `<helmet>` font link and token hexes from `ClientForm.dc.html`. Desktop frames are 1440×1024, mobile 390×844. Use `en-GB` copy (the existing boards do). None of these boards has a sidebar or tab bar.

Every board shares the frame: `#f7f8fa` ground; a 64px header with its controls at the right (16px side padding); below it, a column `max-width: 384px` holding the mark — a 40px `#4f46e5` square, radius 8px, white "L", then "Ledger HQ" at 18px/600 — and, 24px below, a white card (`1px solid #e2e5ea`, radius 8px, padding 20px). Desktop centres the column vertically; mobile starts it 8vh below the header. The header's language control is a 34px ghost icon button (a "languages" stroke icon), `aria-label="Language"`.

| File | Content |
|---|---|
| `AuthSignIn.dc.html` | `<h1>` "Sign in" (24px/600). Email field filled `paulo@example.com`. Master password field filled with eight bullets, red `#b91c1c` border, error line with a circle-alert icon: "The master password must be at least 12 characters long." Primary full-width button "Sign in". Centred ghost small button "Forgot your master password?". |
| `AuthSignInMobile.dc.html` | The same, one column, plus the offline pill in the header left of the language button: a danger pill with a wifi-off icon, "No connection to the server". |
| `AuthRecover.dc.html` | `<h1>` "Regain access"; intro (14px, `#5a6472`): "Use the recovery code you wrote down when you set up the vault, then choose a new master password." Recovery code field, monospace, letter-spaced, value `ABCDE-FGHIJ-KLM`, hint "Six groups of letters and digits, such as ABCDE-FGHIJ-…". New master password (bullets). Confirm the new master password (bullets) with error "The passwords do not match." Primary full-width "Regain access"; ghost small "Back to sign in". |
| `AuthRecoverMobile.dc.html` | The same, one column. |
| `AuthSetup.dc.html` | `<h1>` "Set up your account"; intro: "This is the only account on this Ledger HQ. The master password signs you in and encrypts the vault, so choose one you will remember." Email (empty). Master password with hint "At least 12 characters." Confirm master password. Primary full-width "Create". |
| `AuthSetupMobile.dc.html` | The same, one column. |
| `AuthSplash.dc.html` | The frame and the mark only — no card, no header controls, the mark in exactly the position it has on `AuthSignIn`. |
| `AuthSplashMobile.dc.html` | The same at 390×844. |

- [ ] **Step 3: Add the boards to the index and publish**

In `project/canvas.json` (re-read it immediately before editing; keep every other key as read): add a `boards` entry for each file with a `title` (e.g. "Sign in — desktop"), laid out as a new row 120px below the lowest existing row, 80px between frames, desktop boards first then mobile; append the eight paths to `order`; add a `notes` entry `{"x": <row x>, "y": <row y − 300>, "text": "Auth", "kind": "title1", "maxW": <row width>}`. Publish all nine files in one Artifact call (`url` = the canvas, `root` = the scratch folder, `file_path` = the index's absolute path, the eight boards in `files`). If the publish is refused because someone saved the canvas meanwhile, re-read `canvas.json`, redo the index edit on the new version and publish again. Do not render, screenshot or re-read the canvas to check it — the type's instructions forbid verification unless the human partner asks.

- [ ] **Step 4: Record the row in the roadmap**

In `docs/design/roadmap.md`, in the Mockups table, add a row after the Vault row:

```markdown
| Auth | sign in, recovery, account setup, splash — desktop and mobile each | 5 |
```

- [ ] **Step 5: Commit**

```bash
git add docs/design/roadmap.md
git commit -m "$(cat <<'EOF'
docs(design): draw the auth boards and list them in the roadmap

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `formatRecoveryCode` and the caret helpers

**Files:**
- Create: `apps/web/src/vault/recoveryCode.ts`
- Test: `apps/web/src/vault/recoveryCode.test.ts`

**Interfaces:**
- Consumes: `generateRecoveryCode` from `@ledger-hq/crypto` (test only).
- Produces (Task 6):
  - `formatRecoveryCode(text: string): string` — upper-case, keep `[A-Z2-7]`, cap at 26, join groups of five with `-`.
  - `significantBefore(text: string, caret: number): number` — how many code characters precede `caret` in raw `text`.
  - `caretInFormatted(formatted: string, significant: number): number` — the caret index in `formatted` that sits just after the `significant`-th code character.
  - `RECOVERY_CODE_LENGTH = 26`.

- [ ] **Step 1: Check the prerequisites from Stages 2 and 3**

```bash
cd /Users/pauloaraujo/Projects/personal/ledger-hq
grep -n "Input\|ToastProvider" apps/web/src/ui/index.ts
grep -n "ToastProvider" apps/web/src/shell/AppLayout.tsx
```

Expected: `ui/index.ts` exports `Input` and `ToastProvider`; `AppLayout.tsx` renders `ToastProvider`. If not, stop — Stages 2 and 3 have not landed on this branch.

- [ ] **Step 2: Write the failing test**

`apps/web/src/vault/recoveryCode.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { generateRecoveryCode } from '@ledger-hq/crypto'
import { caretInFormatted, formatRecoveryCode, significantBefore } from './recoveryCode'

const CANONICAL = 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z'

describe('formatRecoveryCode', () => {
  it('upper-cases and groups a code typed without hyphens', () => {
    expect(formatRecoveryCode('abcdefghijklmnopqrstuvwxyz')).toBe(CANONICAL)
  })

  it('drops spaces and any separator that is not a hyphen', () => {
    expect(formatRecoveryCode(' abcde  fghij–klmno_pqrst.uvwxy  z ')).toBe(CANONICAL)
  })

  // Base32 (RFC 4648) has no 0, 1, 8 or 9, so they can only be typos.
  it('drops characters outside the base32 alphabet', () => {
    expect(formatRecoveryCode('AB0C1D8E9')).toBe('ABCDE')
  })

  it('leaves a canonical code unchanged', () => {
    expect(formatRecoveryCode(CANONICAL)).toBe(CANONICAL)
  })

  // The guarantee that matters: any code the generator can produce survives
  // formatting byte for byte, so recovery derives the same key from it.
  it('is a fixed point for codes from the real generator', () => {
    for (let run = 0; run < 50; run += 1) {
      const code = generateRecoveryCode()
      expect(formatRecoveryCode(code)).toBe(code)
    }
  })

  it('caps the code at 26 characters, however much is pasted', () => {
    expect(formatRecoveryCode('A'.repeat(40))).toBe('AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-A')
  })

  it('adds no trailing hyphen after a complete group', () => {
    expect(formatRecoveryCode('abcde')).toBe('ABCDE')
    expect(formatRecoveryCode('ABCDE-')).toBe('ABCDE')
  })

  it('returns an empty string for empty or separator-only input', () => {
    expect(formatRecoveryCode('')).toBe('')
    expect(formatRecoveryCode(' - - ')).toBe('')
  })
})

describe('significantBefore', () => {
  it('counts only code characters before the caret', () => {
    expect(significantBefore('ab-c d', 6)).toBe(4)
    expect(significantBefore('ab-c d', 3)).toBe(2)
    expect(significantBefore('abc', 0)).toBe(0)
  })
})

describe('caretInFormatted', () => {
  it('puts the caret after the n-th code character, skipping hyphens', () => {
    expect(caretInFormatted('ABCDE-F', 6)).toBe(7)
    expect(caretInFormatted('ABCKD-EFGHI-J', 4)).toBe(4)
  })

  it('stays before a hyphen that follows a complete group', () => {
    expect(caretInFormatted('ABCDE-F', 5)).toBe(5)
  })

  it('clamps to the ends', () => {
    expect(caretInFormatted('ABC', 0)).toBe(0)
    expect(caretInFormatted('ABC', 9)).toBe(3)
    expect(caretInFormatted('', 0)).toBe(0)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm --filter @ledger-hq/web test -- recoveryCode
```

Expected: FAIL — cannot resolve `./recoveryCode`.

- [ ] **Step 4: Implement**

`apps/web/src/vault/recoveryCode.ts`:

```ts
/**
 * The recovery code's shape is the vault's: `generateRecoveryCode` in
 * `@ledger-hq/crypto` emits 26 base32 characters in hyphenated groups of
 * five, and `recover.ts` derives keys from that exact string. Anything a
 * person types — lower case, spaces, no hyphens — is normalised to it here,
 * so a right code typed loosely is never rejected as wrong.
 */
export const RECOVERY_CODE_LENGTH = 26

const NOT_BASE32 = /[^A-Z2-7]/g

function significantCharacters(text: string): string {
  return text.toUpperCase().replace(NOT_BASE32, '')
}

/** Upper-cases, keeps only base32 characters, and groups them in fives with hyphens. */
export function formatRecoveryCode(text: string): string {
  const code = significantCharacters(text).slice(0, RECOVERY_CODE_LENGTH)
  return (code.match(/.{1,5}/g) ?? []).join('-')
}

/** How many code characters precede `caret` in the raw, unformatted `text`. */
export function significantBefore(text: string, caret: number): number {
  return significantCharacters(text.slice(0, caret)).length
}

/** The caret index in `formatted` just after its `significant`-th code character. */
export function caretInFormatted(formatted: string, significant: number): number {
  if (significant <= 0) return 0

  let seen = 0
  for (let index = 0; index < formatted.length; index += 1) {
    if (formatted[index] !== '-') seen += 1
    if (seen === significant) return index + 1
  }

  return formatted.length
}
```

- [ ] **Step 5: Run the test**

```bash
pnpm --filter @ledger-hq/web test -- recoveryCode
```

Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/vault/recoveryCode.ts apps/web/src/vault/recoveryCode.test.ts
git commit -m "$(cat <<'EOF'
feat(web): normalise a recovery code however it is typed

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `LanguageMenu` and the shared radio items

**Files:**
- Create: `apps/web/src/shell/LanguageMenu.tsx`
- Test: `apps/web/src/shell/LanguageMenu.test.tsx`
- Modify: `apps/web/src/shell/AccountMenu.tsx` (render `LanguageRadioItems` instead of its own radio group)

**Interfaces:**
- Consumes: `Button`, `DropdownMenu` from `../ui`; `SUPPORTED_LOCALES`, `setLocale`, `SupportedLocale` from `../i18n`.
- Produces:
  - `LanguageRadioItems(): JSX.Element` — the `DropdownMenu.RadioGroup` over `SUPPORTED_LOCALES`; must be rendered inside a `DropdownMenu.Content`. Used by `AccountMenu` (this task) and `LanguageMenu`.
  - `LanguageMenu(): JSX.Element` — a self-contained menu whose trigger is a `ghost` icon `Button` (`Languages`) named `common:language.label` (spec §4.4). Used by `AuthLayout` (Task 4).

`AccountMenu` keeps its signed-out branch in this task: the login screen still renders inside the shell until Task 5, and it still needs the language there. Task 5 removes the branch.

- [ ] **Step 1: Write the failing test**

`apps/web/src/shell/LanguageMenu.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { afterEach, describe, expect, it } from 'vitest'
import { initI18n } from '../i18n'
import { LanguageMenu } from './LanguageMenu'

await initI18n()
// See LoginPage.test.tsx: jsdom reports "en-US" regardless of the host.
await i18next.changeLanguage('pt-PT')

function renderMenu() {
  return render(
    <I18nextProvider i18n={i18next}>
      <LanguageMenu />
    </I18nextProvider>,
  )
}

describe('LanguageMenu', () => {
  afterEach(async () => {
    await i18next.changeLanguage('pt-PT')
  })

  it('is an icon button named for the language', () => {
    renderMenu()

    expect(screen.getByRole('button', { name: 'Idioma' })).toBeInTheDocument()
  })

  it('lists both languages with the active one checked', async () => {
    renderMenu()

    await userEvent.click(screen.getByRole('button', { name: 'Idioma' }))

    expect(await screen.findByRole('menuitemradio', { name: 'Português' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'false')
  })

  it('switches the locale', async () => {
    renderMenu()

    await userEvent.click(screen.getByRole('button', { name: 'Idioma' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'English' }))

    await waitFor(() => expect(i18next.language).toBe('en-GB'))
    expect(document.documentElement.lang).toBe('en-GB')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @ledger-hq/web test -- LanguageMenu
```

Expected: FAIL — cannot resolve `./LanguageMenu`.

- [ ] **Step 3: Implement `LanguageMenu.tsx`**

`apps/web/src/shell/LanguageMenu.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'
import { Button, DropdownMenu } from '../ui'
import { SUPPORTED_LOCALES, setLocale } from '../i18n'
import type { SupportedLocale } from '../i18n'

/**
 * The language list, once. Rendered inside the account menu when signed in
 * and inside `LanguageMenu` on the signed-out screens.
 */
export function LanguageRadioItems() {
  const { t, i18n } = useTranslation('common')

  return (
    <DropdownMenu.RadioGroup value={i18n.language} onValueChange={(value) => void setLocale(value as SupportedLocale)}>
      {SUPPORTED_LOCALES.map((locale) => (
        <DropdownMenu.RadioItem key={locale} value={locale}>
          {t(`language.${locale}`)}
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  )
}

/**
 * The signed-out screens' language control. Account setup records the active
 * language as the account's locale, so it must be reachable before there is
 * an account to open a menu for.
 */
export function LanguageMenu() {
  const { t } = useTranslation('common')

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('language.label')}>
          <Languages aria-hidden="true" className="h-4 w-4" />
        </Button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content>
        <DropdownMenu.Label>{t('language.label')}</DropdownMenu.Label>
        <LanguageRadioItems />
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}
```

The trigger is the spec's ghost icon `Button` (§4.4) under Radix's own `asChild` (not Stage 2's `Button asChild`, which is for links). Radix's `Slot` hands the trigger's props and its ref to `Button`; under React 19 `ref` is an ordinary prop, so it reaches the `<button>` through `Button`'s `...rest` spread, and the menu anchors to it. `size="icon"` makes `aria-label` required by type.

- [ ] **Step 4: Make `AccountMenu` use the shared items**

In `apps/web/src/shell/AccountMenu.tsx`:

1. Delete the imports of `SUPPORTED_LOCALES`, `setLocale` and `SupportedLocale` from `'../i18n'`, and add `import { LanguageRadioItems } from './LanguageMenu'`.
2. Replace the whole `<DropdownMenu.RadioGroup …>…</DropdownMenu.RadioGroup>` block with `<LanguageRadioItems />`.
3. `i18n` from `useTranslation('common')` is now unused — destructure only `t`.

Leave the `signedIn` logic, the pending guard and the `Languages` trigger icon as they are; Task 5 removes them.

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- LanguageMenu AccountMenu
```

Expected: PASS — the new file's 3 tests and all 6 existing `AccountMenu` tests, unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/shell/LanguageMenu.tsx apps/web/src/shell/LanguageMenu.test.tsx apps/web/src/shell/AccountMenu.tsx
git commit -m "$(cat <<'EOF'
refactor(web): extract the language control into LanguageMenu

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `AuthLayout` and `AuthSplash`

**Files:**
- Create: `apps/web/src/auth/AuthLayout.tsx`
- Create: `apps/web/src/auth/AuthSplash.tsx`
- Test: `apps/web/src/auth/AuthLayout.test.tsx`
- Modify: `apps/web/src/i18n/locales/pt/common.json`, `apps/web/src/i18n/locales/en/common.json` (`loading`)

**Interfaces:**
- Consumes: `Card` from `../ui`; `ConnectionStatus` from `../shell/ConnectionStatus`; `LanguageMenu` from `../shell/LanguageMenu` (Task 3).
- Produces (Task 5):
  - `AuthLayout({ children }: { children: ReactNode })` — frame, header (connection pill + language menu), mark, and `children` inside a `Card`.
  - `AuthSplash()` — the same frame and mark, no header controls, no card, `aria-busy="true"`, visually hidden `common:loading`.
  - `AuthMark()`, `AuthFrame({ header?, busy?, children })` — exported for `AuthSplash`; not used elsewhere.

- [ ] **Step 1: Add the key**

In `apps/web/src/i18n/locales/pt/common.json`, after `"appName": "Ledger HQ",` add:

```json
  "loading": "A carregar",
```

In `apps/web/src/i18n/locales/en/common.json`, in the same place:

```json
  "loading": "Loading",
```

- [ ] **Step 2: Write the failing test**

`apps/web/src/auth/AuthLayout.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { initI18n } from '../i18n'
import { AuthLayout } from './AuthLayout'
import { AuthSplash } from './AuthSplash'

await initI18n()
// See LoginPage.test.tsx: jsdom reports "en-US" regardless of the host.
await i18next.changeLanguage('pt-PT')

function renderWithProviders(node: ReactNode) {
  // ConnectionStatus reads the query cache for its last-sync time.
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>{node}</I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('AuthLayout', () => {
  it('renders the page inside the card, with the mark and the language menu', () => {
    renderWithProviders(
      <AuthLayout>
        <h1>Entrar</h1>
      </AuthLayout>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument()
    expect(screen.getByText('Ledger HQ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Idioma' })).toBeInTheDocument()
  })

  it('has no navigation and exactly one main landmark', () => {
    renderWithProviders(
      <AuthLayout>
        <p>conteúdo</p>
      </AuthLayout>,
    )

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })
})

describe('AuthSplash', () => {
  it('announces loading once and shows the mark without controls', () => {
    const { container } = renderWithProviders(<AuthSplash />)

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.getByText('A carregar')).toBeInTheDocument()
    expect(screen.getByText('Ledger HQ')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm --filter @ledger-hq/web test -- AuthLayout
```

Expected: FAIL — cannot resolve `./AuthLayout`.

- [ ] **Step 4: Implement `AuthLayout.tsx`**

`apps/web/src/auth/AuthLayout.tsx`:

```tsx
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '../ui'
import { ConnectionStatus } from '../shell/ConnectionStatus'
import { LanguageMenu } from '../shell/LanguageMenu'

/** The sidebar's mark at 40px, so the shell that appears after sign-in is visibly the same product. */
export function AuthMark() {
  const { t } = useTranslation('common')

  return (
    <span className="flex items-center gap-3 text-lg font-semibold tracking-tight">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-surface bg-accent-600 text-base font-semibold text-white"
      >
        L
      </span>
      {t('appName')}
    </span>
  )
}

type AuthFrameProps = { header?: ReactNode; busy?: boolean; children: ReactNode }

/**
 * Shared by the layout and the splash so the mark sits in exactly the same
 * place in both. The header keeps its 64px height even when empty, which is
 * what stops the mark jumping when the splash gives way to the card.
 *
 * On mobile the column starts near the top rather than centring, so the
 * on-screen keyboard does not push the submit button out of view.
 */
export function AuthFrame({ header, busy = false, children }: AuthFrameProps) {
  return (
    <div aria-busy={busy || undefined} className="flex min-h-dvh flex-col bg-ground text-ink">
      <header className="flex h-16 items-center justify-end gap-2 px-4">{header}</header>
      <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-[8vh] md:items-center md:pt-0">
        <div className="flex w-full max-w-sm flex-col items-center gap-6">{children}</div>
      </main>
    </div>
  )
}

/** The signed-out screens' layout: no shell, one card, language and connection always reachable. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <AuthFrame
      header={
        <>
          <ConnectionStatus />
          <LanguageMenu />
        </>
      }
    >
      <AuthMark />
      <Card className="w-full">{children}</Card>
    </AuthFrame>
  )
}
```

- [ ] **Step 5: Implement `AuthSplash.tsx`**

`apps/web/src/auth/AuthSplash.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { AuthFrame, AuthMark } from './AuthLayout'

/**
 * What shows while the session resolves — usually a few milliseconds. A
 * static mark, not a spinner: the card or the shell then replaces it in
 * place, which reads as one screen rather than a flash.
 */
export function AuthSplash() {
  const { t } = useTranslation('common')

  return (
    <AuthFrame busy>
      <AuthMark />
      <span className="sr-only">{t('loading')}</span>
    </AuthFrame>
  )
}
```

- [ ] **Step 6: Run the tests and the locale check**

```bash
pnpm --filter @ledger-hq/web test -- AuthLayout locales
pnpm --filter @ledger-hq/web i18n:check
```

Expected: PASS; "Locale bundles agree on N keys."

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/auth/AuthLayout.tsx apps/web/src/auth/AuthSplash.tsx apps/web/src/auth/AuthLayout.test.tsx apps/web/src/i18n/locales/pt/common.json apps/web/src/i18n/locales/en/common.json
git commit -m "$(cat <<'EOF'
feat(web): add a standalone layout and splash for signed-out screens

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Move the session gate above the shell

**Files:**
- Create: `apps/web/src/auth/RequireSession.tsx`
- Test: `apps/web/src/auth/RequireSession.test.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/shell/AppLayout.tsx`
- Modify: `apps/web/src/shell/AppLayout.test.tsx`
- Modify: `apps/web/src/shell/AccountMenu.tsx`
- Modify: `apps/web/src/shell/AccountMenu.test.tsx`
- Modify: `apps/web/e2e/setup-and-clients.spec.ts` (the language test)

**Interfaces:**
- Consumes: `AuthLayout`, `AuthSplash` (Task 4); `LoginPage`, `SetupPage` (unchanged until Tasks 6-7); `useBootstrapRequired`, `useSession` from `./session`.
- Produces: `RequireSession({ children }: { children: ReactNode })` — the gate; `children` render only with a session. The root route's component is `Root` (local to `router.tsx`): `<RequireSession><AppLayout /></RequireSession>`. `AppLayout` assumes a session from here on.

The decision logic is today's, moved verbatim: bootstrap first, then the session. Only what each branch renders changes.

- [ ] **Step 1: Write the failing test**

`apps/web/src/auth/RequireSession.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ApiError } from '../api/client'
import type * as ApiClientModule from '../api/client'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>()
  return { ...actual, apiFetch }
})

const { RequireSession } = await import('./RequireSession')

await initI18n()
// See LoginPage.test.tsx: jsdom reports "en-US" regardless of the host.
await i18next.changeLanguage('pt-PT')

function renderGate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RequireSession>
          <nav aria-label="shell">o shell</nav>
        </RequireSession>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('RequireSession', () => {
  beforeEach(() => {
    apiFetch.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the splash while the session is resolving', () => {
    apiFetch.mockImplementation(() => new Promise(() => {}))
    renderGate()

    expect(screen.getByText('A carregar')).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('shows account setup in the auth layout on a fresh install', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/auth/bootstrap-required') return { required: true }
      if (path === '/auth/session') throw new ApiError('auth.session_expired', {}, 401)
      throw new Error(`unexpected path in test: ${path}`)
    })
    renderGate()

    expect(await screen.findByRole('heading', { level: 1, name: /configura a tua conta/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Idioma' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('shows sign-in in the auth layout without a session, and no shell at all', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/auth/bootstrap-required') return { required: false }
      if (path === '/auth/session') throw new ApiError('auth.session_expired', {}, 401)
      throw new Error(`unexpected path in test: ${path}`)
    })
    renderGate()

    expect(await screen.findByRole('heading', { level: 1, name: /entrar/i })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByText('o shell')).not.toBeInTheDocument()
  })

  // Review Focus 3: offline on first load, nothing cached. Both requests fail
  // as the browser fails them — `fetch` itself rejects with a TypeError, which
  // the real apiFetch turns into ApiError('common.offline'). The gate must
  // land on sign-in, not hang on the splash.
  it('shows sign-in when both requests fail at the network', async () => {
    const actual = await vi.importActual<typeof ApiClientModule>('../api/client')
    apiFetch.mockImplementation(actual.apiFetch)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    renderGate()

    expect(await screen.findByRole('heading', { level: 1, name: /entrar/i })).toBeInTheDocument()
    expect(screen.queryByText('A carregar')).not.toBeInTheDocument()
  })

  it('renders the shell once there is a session', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/auth/bootstrap-required') return { required: false }
      if (path === '/auth/session') return { id: '1', email: 'paulo@example.com', locale: 'pt-PT' }
      throw new Error(`unexpected path in test: ${path}`)
    })
    renderGate()

    expect(await screen.findByRole('navigation', { name: 'shell' })).toBeInTheDocument()
    expect(screen.queryByText('A carregar')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @ledger-hq/web test -- RequireSession
```

Expected: FAIL — cannot resolve `./RequireSession`.

- [ ] **Step 3: Implement `RequireSession.tsx`**

`apps/web/src/auth/RequireSession.tsx`:

```tsx
import type { ReactNode } from 'react'
import { useBootstrapRequired, useSession } from './session'
import { AuthLayout } from './AuthLayout'
import { AuthSplash } from './AuthSplash'
import { LoginPage } from './LoginPage'
import { SetupPage } from './SetupPage'

/**
 * Wraps the whole shell, not just its content: without a session there is no
 * sidebar, tab bar, search box or account menu — none of them can do anything
 * for someone who is not signed in.
 *
 * The order is the one this gate has always had: a fresh install sets up the
 * account before anything else; otherwise no session means sign-in.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const bootstrap = useBootstrapRequired()
  const session = useSession()

  if (bootstrap.isPending || session.isPending) return <AuthSplash />

  if (bootstrap.data?.required === true) {
    return (
      <AuthLayout>
        <SetupPage />
      </AuthLayout>
    )
  }

  if (session.isError) {
    return (
      <AuthLayout>
        <LoginPage />
      </AuthLayout>
    )
  }

  return <>{children}</>
}
```

- [ ] **Step 4: Point the root route at `Root`**

In `apps/web/src/router.tsx`:

1. Delete the `import type { ReactNode } from 'react'` line, the imports of `useBootstrapRequired`, `useSession`, `LoginPage` and `SetupPage`, and the whole exported `RequireSession` function.
2. Add `import { RequireSession } from './auth/RequireSession'`.
3. Replace `const rootRoute = createRootRoute({ component: AppLayout })` with:

```tsx
function Root() {
  return (
    <RequireSession>
      <AppLayout />
    </RequireSession>
  )
}

const rootRoute = createRootRoute({ component: Root })
```

Every route below it is unchanged.

- [ ] **Step 5: Stop `AppLayout` from gating**

In `apps/web/src/shell/AppLayout.tsx`, delete `import { RequireSession } from '../router'` and replace

```tsx
          <RequireSession>
            <Outlet />
          </RequireSession>
```

with

```tsx
          <Outlet />
```

Leave everything else — including Stage 3's `ToastProvider` wrapper and `useVaultSync()` — exactly as it is. `useVaultSync()` now only ever runs with a session, which is when it did anything anyway. Add one comment above the component:

```tsx
/** The signed-in shell. `RequireSession` (auth/RequireSession.tsx) renders it only with a session. */
```

- [ ] **Step 6: Remove `AccountMenu`'s signed-out branch**

`apps/web/src/shell/AccountMenu.tsx` becomes:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Lock, LogOut } from 'lucide-react'
import { DropdownMenu } from '../ui'
import { signOut } from '../auth/credentials'
import { SESSION_QUERY_KEY, useSession } from '../auth/session'
import { lockVault, useVaultState } from '../vault/vault-session'
import { LanguageRadioItems } from './LanguageMenu'

function initialsOf(email: string): string {
  return email.slice(0, 2).toUpperCase()
}

/** Rendered only inside the signed-in shell; the signed-out screens use `LanguageMenu`. */
export function AccountMenu() {
  const { t } = useTranslation('common')
  const queryClient = useQueryClient()
  const session = useSession()
  const vaultState = useVaultState()
  const email = session.data?.email ?? ''

  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    },
  })

  return (
    <DropdownMenu>
      {/*
       * Named by the session's own email: there is no key that means "account
       * menu", and the address says more than "Account".
       */}
      <DropdownMenu.Trigger
        aria-label={email}
        className="flex items-center gap-2 rounded-surface border border-line bg-surface p-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-50 text-xs font-semibold text-accent-700">
          {initialsOf(email)}
        </span>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content>
        <DropdownMenu.Label>{t('language.label')}</DropdownMenu.Label>
        <LanguageRadioItems />

        <DropdownMenu.Separator />

        {vaultState.status === 'unlocked' && (
          <DropdownMenu.Item onSelect={() => lockVault()}>
            <Lock aria-hidden="true" className="h-4 w-4 text-muted" />
            {t('actions.lockVault')}
          </DropdownMenu.Item>
        )}

        <DropdownMenu.Item
          className="text-danger-700"
          disabled={signOutMutation.isPending}
          onSelect={() => signOutMutation.mutate()}
        >
          <LogOut aria-hidden="true" className="h-4 w-4" />
          {t('actions.signOut')}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}
```

The `session.isPending` guard goes too: it existed only so the signed-out trigger would not flash while the session loaded, and the shell now renders only after the session has resolved.

- [ ] **Step 7: Update `AccountMenu.test.tsx`**

Delete the two tests `'offers language only, named for it, when there is no session'` and `'renders no trigger at all while the session is still loading'`, and delete the now-unused `import { ApiError } from '../api/client'`. The remaining four tests (open/close, lock vault, sign out, switch locale) stay as they are; the locale test now exercises `LanguageRadioItems` through the account menu.

- [ ] **Step 8: Update `AppLayout.test.tsx`**

`AppLayout` no longer gates, so the test renders the shell the way the router does. Add `import { RequireSession } from '../auth/RequireSession'` (after the `vi.mock` blocks, as a dynamic import next to `AppLayout`'s):

```tsx
const { AppLayout } = await import('./AppLayout')
const { RequireSession } = await import('../auth/RequireSession')
```

and in `renderLayout` replace

```tsx
  const rootRoute = createRootRoute({ component: AppLayout })
```

with

```tsx
  const rootRoute = createRootRoute({
    component: () => (
      <RequireSession>
        <AppLayout />
      </RequireSession>
    ),
  })
```

Then strengthen the end of `'signs the user out and returns them to the login screen'` (Review Focus 4) — after the existing final `expect(await screen.findByRole('heading', …))`, add:

```tsx
    // The whole shell is gone, not just its content: no sidebar, no tab bar,
    // no account menu behind the sign-in card.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /paulo@example\.com/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
```

Update its comment "RequireSession renders the login page" to "RequireSession renders the auth layout with the login page".

- [ ] **Step 9: Run the unit suite**

```bash
pnpm --filter @ledger-hq/web test
```

Expected: PASS. If a test outside the files above now fails, it rendered something signed-out through the shell and is a real regression to look at — the spec's risk §10.

- [ ] **Step 10: Fix the e2e language test**

`apps/web/e2e/setup-and-clients.spec.ts`'s `'switches language without losing the page'` asserts a `Clients` link while signed out — a nav link that no longer exists signed out. Stage 2 leaves this test alone (it appends its edit journey and phone-width check to the *first* test), so replace the whole test — from `test('switches language without losing the page'` to its closing `})` — with:

```ts
test('switches language without losing the page', async ({ page }) => {
  await page.goto('/')

  // Signed out, the language control is the auth layout's own menu.
  await page.getByRole('button', { name: /idioma|language/i }).click()
  await page.getByRole('menuitemradio', { name: 'English' }).click()

  // Sign-in or, on a fresh install, account setup — both now in English.
  await expect(page.getByRole('heading', { level: 1, name: /^sign in$|^set up your account$/i })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB')
})
```

Run it:

```bash
pnpm --filter @ledger-hq/web test:e2e -- setup-and-clients shell offline
```

Expected: PASS. The existing `shell.spec.ts` tests (Stage 4's phone-width dialog check among them) sign in first and must pass unchanged. `offline.spec.ts` starts signed out, so after the reload with the network down it now lands on the auth layout's sign-in card (spec §4.1, offline first load) instead of the shell: its `getByText(/ledger hq/i)` finds `AuthMark`, and its `getByRole('status')` finds the connection pill in the auth header — it passes unchanged, and is the real-browser proof that the gate never sticks on the splash.

- [ ] **Step 11: Typecheck and commit**

```bash
pnpm typecheck
git add apps/web/src/auth/RequireSession.tsx apps/web/src/auth/RequireSession.test.tsx apps/web/src/router.tsx apps/web/src/shell/AppLayout.tsx apps/web/src/shell/AppLayout.test.tsx apps/web/src/shell/AccountMenu.tsx apps/web/src/shell/AccountMenu.test.tsx apps/web/e2e/setup-and-clients.spec.ts
git commit -m "$(cat <<'EOF'
feat(web): render signed-out screens outside the shell

The session gate wraps the whole shell instead of its content, so
sign-in no longer sits beside a sidebar whose every link leads back
to sign-in. The account menu loses its signed-out variant; the
language control moves to the auth layout.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `LoginPage` — sign-in and recovery

**Files:**
- Modify: `apps/web/src/auth/LoginPage.tsx`
- Test: `apps/web/src/auth/LoginPage.test.tsx`
- Modify: `apps/web/src/i18n/locales/pt/common.json`, `apps/web/src/i18n/locales/en/common.json` (`auth.recoverIntro`, `auth.recoveryCodeHint`)

**Interfaces:**
- Consumes: `Input`, `Button` from `../ui` (Stage 2); `formatRecoveryCode`, `significantBefore`, `caretInFormatted` (Task 2); `signIn`, `recoverVault`, `SESSION_QUERY_KEY`, `MIN_MASTER_PASSWORD_LENGTH` (unchanged).
- Produces: `LoginPage()` — same export, same behaviour, rendered inside `AuthLayout`'s card by Task 5.

- [ ] **Step 1: Add the keys**

In `apps/web/src/i18n/locales/pt/common.json`, inside `"auth"`, after `"recoverButton"` (add a comma to the line before):

```json
    "recoverIntro": "Usa o código de recuperação que anotaste ao configurar o cofre e escolhe a seguir uma nova palavra-passe mestra.",
    "recoveryCodeHint": "Seis grupos de letras e números, por exemplo ABCDE-FGHIJ-…"
```

In `apps/web/src/i18n/locales/en/common.json`, in the same place:

```json
    "recoverIntro": "Use the recovery code you wrote down when you set up the vault, then choose a new master password.",
    "recoveryCodeHint": "Six groups of letters and digits, such as ABCDE-FGHIJ-…"
```

(Both locales' copy is the spec's §7, verbatim.)

- [ ] **Step 2: Write the failing tests**

Replace the whole of `apps/web/src/auth/LoginPage.test.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { initI18n } from '../i18n'

import { ApiError } from '../api/client'

const signIn = vi.hoisted(() => vi.fn())
vi.mock('./credentials', () => ({ signIn }))

const recoverVaultMock = vi.hoisted(() => vi.fn())
vi.mock('../vault/recover', () => ({ recoverVault: recoverVaultMock }))

const { LoginPage } = await import('./LoginPage')

await initI18n()
// jsdom reports navigator.language as "en-US", which initI18n reads to pick
// the initial locale — overriding the pt-PT fallback the assertion below
// relies on. Pin the language explicitly so the test is deterministic
// regardless of the host's locale detection.
await i18next.changeLanguage('pt-PT')

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <LoginPage />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

async function openRecovery() {
  renderPage()
  await userEvent.click(screen.getByRole('button', { name: /esqueceste a palavra-passe/i }))
}

describe('LoginPage', () => {
  beforeEach(() => {
    signIn.mockReset()
  })

  it('submits the email and master password', async () => {
    signIn.mockResolvedValue(undefined)
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/palavra-passe|master password/i), 'a long master password')
    await userEvent.click(screen.getByRole('button', { name: /^entrar$/i }))

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('paulo@example.com', 'a long master password')
    })
  })

  it('uses the autocomplete tokens password managers need', () => {
    renderPage()

    expect(screen.getByLabelText(/email/i)).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText(/palavra-passe mestra/i)).toHaveAttribute('autocomplete', 'current-password')
  })

  it('shows a translated message when the credentials are rejected', async () => {
    // A real ApiError, because ErrorMessage translates only instances of it.
    signIn.mockRejectedValue(new ApiError('auth.invalid_credentials', {}, 401))
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    // Long enough to clear the client-side minimum-length gate — this test
    // is about the server rejecting it, not the length check.
    await userEvent.type(screen.getByLabelText(/palavra-passe|master password/i), 'wrong password')
    await userEvent.click(screen.getByRole('button', { name: /^entrar$/i }))

    expect(await screen.findByText(/credenciais inválidas/i)).toBeInTheDocument()
  })

  it('refuses a too-short master password as the field’s own error, before calling the API', async () => {
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/palavra-passe|master password/i), 'short1')
    await userEvent.click(screen.getByRole('button', { name: /^entrar$/i }))

    const password = screen.getByLabelText(/palavra-passe mestra/i)
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAccessibleDescription(/pelo menos 12 caracteres/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/pelo menos 12 caracteres/i)
    expect(signIn).not.toHaveBeenCalled()
  })
})

describe('recovery mode', () => {
  beforeEach(() => {
    recoverVaultMock.mockReset()
  })

  it('switches to the recovery form and back', async () => {
    await openRecovery()
    expect(screen.getByRole('heading', { level: 1, name: /recuperar acesso/i })).toBeInTheDocument()
    expect(screen.getByText(/usa o código de recuperação/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /voltar a entrar/i }))
    expect(screen.getByRole('heading', { level: 1, name: /^entrar$/i })).toBeInTheDocument()
  })

  it('submits the recovery code and new password', async () => {
    recoverVaultMock.mockResolvedValue(undefined)
    await openRecovery()

    await userEvent.type(screen.getByLabelText(/código de recuperação/i), 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')
    await userEvent.type(screen.getByLabelText('Nova palavra-passe mestra'), 'a new long master password')
    await userEvent.type(screen.getByLabelText(/confirma a nova palavra-passe/i), 'a new long master password')
    await userEvent.click(screen.getByRole('button', { name: /^recuperar acesso$/i }))

    await vi.waitFor(() => {
      expect(recoverVaultMock).toHaveBeenCalledWith('a new long master password', 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')
    })
  })

  it('normalises a code typed in lower case without hyphens', async () => {
    recoverVaultMock.mockResolvedValue(undefined)
    await openRecovery()

    const code = screen.getByLabelText(/código de recuperação/i)
    await userEvent.type(code, 'abcdefghijklmnopqrstuvwxyz')
    expect(code).toHaveValue('ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')

    await userEvent.type(screen.getByLabelText('Nova palavra-passe mestra'), 'a new long master password')
    await userEvent.type(screen.getByLabelText(/confirma a nova palavra-passe/i), 'a new long master password')
    await userEvent.click(screen.getByRole('button', { name: /^recuperar acesso$/i }))

    await vi.waitFor(() => {
      expect(recoverVaultMock).toHaveBeenCalledWith('a new long master password', 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')
    })
  })

  // Review Focus 1: a pasted code longer than 31 characters (extra spaces)
  // must not be truncated before it is normalised — so the field has no
  // maxLength; the formatter caps the code itself.
  it('normalises a pasted code with extra spacing', async () => {
    await openRecovery()

    const code = screen.getByLabelText(/código de recuperação/i)
    expect(code).not.toHaveAttribute('maxlength')
    await userEvent.click(code)
    await userEvent.paste(' abcde  fghij  klmno  pqrst  uvwxy  z ')

    expect(code).toHaveValue('ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')
  })

  // Review Focus 2: re-grouping moves characters across hyphens; the caret
  // must follow the character just typed, or the next keystroke lands at the
  // end and scrambles the code.
  it('keeps the caret in place when typing in the middle of the code', async () => {
    await openRecovery()

    const code = screen.getByLabelText<HTMLInputElement>(/código de recuperação/i)
    await userEvent.type(code, 'ABCDEFGHIJ')
    expect(code).toHaveValue('ABCDE-FGHIJ')

    await userEvent.type(code, 'K', { initialSelectionStart: 3, initialSelectionEnd: 3 })
    expect(code).toHaveValue('ABCKD-EFGHI-J')
    expect(code.selectionStart).toBe(4)

    await userEvent.type(code, 'L', { skipClick: true })
    expect(code).toHaveValue('ABCKL-DEFGH-IJ')
  })

  it('shows length and mismatch problems on the fields they belong to', async () => {
    await openRecovery()

    const newPassword = screen.getByLabelText('Nova palavra-passe mestra')
    const confirmation = screen.getByLabelText(/confirma a nova palavra-passe/i)

    await userEvent.type(newPassword, 'short1')
    expect(newPassword).toHaveAttribute('aria-invalid', 'true')
    expect(newPassword).toHaveAccessibleDescription(/pelo menos 12 caracteres/i)

    await userEvent.type(confirmation, 'short2')
    expect(confirmation).toHaveAttribute('aria-invalid', 'true')
    expect(confirmation).toHaveAccessibleDescription(/não coincidem/i)

    await userEvent.click(screen.getByRole('button', { name: /^recuperar acesso$/i }))
    expect(recoverVaultMock).not.toHaveBeenCalled()
  })

  it('turns off the browser’s own text assistance on the code', async () => {
    await openRecovery()

    const code = screen.getByLabelText(/código de recuperação/i)
    expect(code).toHaveAttribute('autocomplete', 'off')
    expect(code).toHaveAttribute('spellcheck', 'false')
    expect(code).toHaveAttribute('autocapitalize', 'characters')
    expect(code).toHaveAccessibleDescription(/seis grupos/i)
  })
})
```

- [ ] **Step 3: Run them and watch the new ones fail**

```bash
pnpm --filter @ledger-hq/web test -- LoginPage
```

Expected: FAIL — among others, `aria-invalid` is missing on the too-short password, the code is not normalised (`abcdef…` stays lower case), the recovery intro is not found.

- [ ] **Step 4: Implement**

Replace the whole of `apps/web/src/auth/LoginPage.tsx` with:

```tsx
import { useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MIN_MASTER_PASSWORD_LENGTH } from '@ledger-hq/crypto'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Input } from '../ui'
import { recoverVault } from '../vault/recover'
import { caretInFormatted, formatRecoveryCode, significantBefore } from '../vault/recoveryCode'
import { signIn } from './credentials'
import { SESSION_QUERY_KEY } from './session'

/** The card's own heading block: AuthLayout has no PageHeader, by design. */
function CardHeading({ title, intro }: { title: string; intro?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {intro !== undefined && <p className="text-sm text-muted">{intro}</p>}
    </div>
  )
}

export function LoginPage() {
  const { t } = useTranslation('common')
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'login' | 'recover'>('login')
  const [email, setEmail] = useState('')
  const [masterPassword, setMasterPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [newMasterPassword, setNewMasterPassword] = useState('')
  const [confirmNewMasterPassword, setConfirmNewMasterPassword] = useState('')

  // Formatting the code re-groups it, which moves characters across hyphens.
  // The caret index computed in onChange is applied after React writes the
  // new value, so the next keystroke lands where the reader is typing.
  const recoveryCodeRef = useRef<HTMLInputElement>(null)
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return
    recoveryCodeRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  })

  const tooShort = t('auth.passwordTooShort', { min: MIN_MASTER_PASSWORD_LENGTH })

  const passwordTooShort = masterPassword.length > 0 && masterPassword.length < MIN_MASTER_PASSWORD_LENGTH

  const loginMutation = useMutation({
    mutationFn: () => signIn(email, masterPassword),
    onSuccess: async () => {
      setMasterPassword('')
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    },
  })

  const newPasswordTooShort =
    newMasterPassword.length > 0 && newMasterPassword.length < MIN_MASTER_PASSWORD_LENGTH
  const newPasswordsMismatch =
    confirmNewMasterPassword.length > 0 && newMasterPassword !== confirmNewMasterPassword

  const recoverMutation = useMutation({
    mutationFn: () => recoverVault(newMasterPassword, recoveryCode),
    onSuccess: async () => {
      setRecoveryCode('')
      setNewMasterPassword('')
      setConfirmNewMasterPassword('')
      setMode('login')
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    },
  })

  if (mode === 'recover') {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (newPasswordTooShort || newPasswordsMismatch) return
          recoverMutation.mutate()
        }}
      >
        <CardHeading title={t('auth.recoverTitle')} intro={t('auth.recoverIntro')} />

        {/*
         * No maxLength: it would cut a pasted code with extra spacing before
         * formatRecoveryCode could normalise it. The formatter caps the code.
         */}
        <Input
          ref={recoveryCodeRef}
          label={t('auth.recoveryCodeLabel')}
          hint={t('auth.recoveryCodeHint')}
          required
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          className="font-mono tracking-wider"
          value={recoveryCode}
          onChange={(event) => {
            const { value, selectionStart } = event.target
            const formatted = formatRecoveryCode(value)
            pendingCaret.current = caretInFormatted(formatted, significantBefore(value, selectionStart ?? value.length))
            setRecoveryCode(formatted)
          }}
        />

        <Input
          type="password"
          autoComplete="new-password"
          required
          label={t('auth.newMasterPasswordLabel')}
          value={newMasterPassword}
          onChange={(event) => setNewMasterPassword(event.target.value)}
          error={newPasswordTooShort ? tooShort : undefined}
        />

        <Input
          type="password"
          autoComplete="new-password"
          required
          label={t('auth.confirmNewMasterPasswordLabel')}
          value={confirmNewMasterPassword}
          onChange={(event) => setConfirmNewMasterPassword(event.target.value)}
          error={newPasswordsMismatch ? t('auth.passwordMismatch') : undefined}
        />

        <ErrorMessage error={recoverMutation.error} />

        <Button
          type="submit"
          variant="primary"
          className="w-full"
          isLoading={recoverMutation.isPending}
          disabled={newPasswordTooShort || newPasswordsMismatch}
        >
          {t('auth.recoverButton')}
        </Button>

        <Button variant="ghost" size="sm" className="self-center" onClick={() => setMode('login')}>
          {t('auth.backToLogin')}
        </Button>
      </form>
    )
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (passwordTooShort) return
        loginMutation.mutate()
      }}
    >
      <CardHeading title={t('auth.loginTitle')} />

      <Input
        type="email"
        autoComplete="username"
        required
        label={t('auth.emailLabel')}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <Input
        type="password"
        autoComplete="current-password"
        required
        label={t('auth.masterPasswordLabel')}
        value={masterPassword}
        onChange={(event) => setMasterPassword(event.target.value)}
        error={passwordTooShort ? tooShort : undefined}
      />

      <ErrorMessage error={loginMutation.error} />

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        isLoading={loginMutation.isPending}
        disabled={passwordTooShort}
      >
        {t('actions.signIn')}
      </Button>

      <Button variant="ghost" size="sm" className="self-center" onClick={() => setMode('recover')}>
        {t('auth.forgotPassword')}
      </Button>
    </form>
  )
}
```

Two notes for the implementer:

- `useLayoutEffect` has no dependency array on purpose: it must run after every render that wrote a new code value, and it is a no-op whenever `pendingCaret` is `null`.
- The submit button is disabled while `passwordTooShort`, as today; the too-short test still clicks it, which does nothing — the assertion is that the error is on the field and `signIn` was never called.

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- LoginPage locales
pnpm --filter @ledger-hq/web i18n:check
```

Expected: PASS (11 `LoginPage` tests). If the caret test fails on `selectionStart` only, check that Stage 2's `Input` forwards `ref` to the `<input>` and not its wrapper — the spec's §5 contract; do not work around it here.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/auth/LoginPage.tsx apps/web/src/auth/LoginPage.test.tsx apps/web/src/i18n/locales/pt/common.json apps/web/src/i18n/locales/en/common.json
git commit -m "$(cat <<'EOF'
feat(web): restyle sign-in and recovery on the form controls

Validation messages become the fields' own errors, and the recovery
code is normalised as it is typed or pasted, keeping the caret where
the reader is typing.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `SetupPage` — account setup

**Files:**
- Modify: `apps/web/src/auth/SetupPage.tsx`
- Test: `apps/web/src/auth/SetupPage.test.tsx`
- Modify: `apps/web/src/i18n/locales/pt/common.json`, `apps/web/src/i18n/locales/en/common.json` (`auth.setupIntro`, `auth.passwordHint`)

**Interfaces:**
- Consumes: `Input`, `Button` from `../ui`; `AuthLayout` (Task 4, test only); `createAccount`, `SESSION_QUERY_KEY`, `MIN_MASTER_PASSWORD_LENGTH` (unchanged).
- Produces: `SetupPage()` — same export, rendered inside `AuthLayout` by Task 5.

- [ ] **Step 1: Add the keys**

In `apps/web/src/i18n/locales/pt/common.json`, inside `"auth"`, after `"recoveryCodeHint"` (comma on the line before):

```json
    "setupIntro": "Esta é a única conta deste Ledger HQ. A palavra-passe mestra serve para entrar e para cifrar o cofre — escolhe uma de que te lembres.",
    "passwordHint": "Pelo menos {{min}} caracteres."
```

In `apps/web/src/i18n/locales/en/common.json`, in the same place:

```json
    "setupIntro": "This is the only account on this Ledger HQ. The master password signs you in and encrypts the vault, so choose one you will remember.",
    "passwordHint": "At least {{min}} characters."
```

- [ ] **Step 2: Write the failing tests**

Replace the whole of `apps/web/src/auth/SetupPage.test.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { initI18n } from '../i18n'

const createAccount = vi.hoisted(() => vi.fn())
vi.mock('./credentials', () => ({ createAccount }))

const { SetupPage } = await import('./SetupPage')
const { AuthLayout } = await import('./AuthLayout')

await initI18n()
// See LoginPage.test.tsx: jsdom reports "en-US" regardless of the host,
// overriding the pt-PT fallback these assertions rely on.
await i18next.changeLanguage('pt-PT')

function renderWithProviders(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>{node}</I18nextProvider>
    </QueryClientProvider>,
  )
}

const renderPage = () => renderWithProviders(<SetupPage />)

describe('SetupPage', () => {
  beforeEach(() => {
    createAccount.mockReset()
  })

  afterEach(async () => {
    await i18next.changeLanguage('pt-PT')
  })

  it('introduces the one account and states the minimum length up front', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: /configura a tua conta/i })).toBeInTheDocument()
    expect(screen.getByText(/única conta deste ledger hq/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^palavra-passe mestra$/i)).toHaveAccessibleDescription('Pelo menos 12 caracteres.')
  })

  it('refuses a too-short master password before any derivation is attempted', async () => {
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/^palavra-passe mestra$/i), 'short1')
    await userEvent.type(screen.getByLabelText(/confirma a palavra-passe/i), 'short1')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    const password = screen.getByLabelText(/^palavra-passe mestra$/i)
    expect(password).toHaveAttribute('aria-invalid', 'true')
    // The hint says the same number, so query the alert, not the text.
    expect(screen.getByRole('alert')).toHaveTextContent(/pelo menos 12 caracteres/i)
    // Nothing was ever submitted: no account-creation call (and therefore
    // no Argon2 derivation) was attempted with the too-short password.
    expect(createAccount).not.toHaveBeenCalled()
  })

  it('shows a mismatch on the confirmation field', async () => {
    renderPage()

    await userEvent.type(screen.getByLabelText(/^palavra-passe mestra$/i), 'a long master password')
    await userEvent.type(screen.getByLabelText(/confirma a palavra-passe/i), 'a different long password')

    const confirmation = screen.getByLabelText(/confirma a palavra-passe/i)
    expect(confirmation).toHaveAttribute('aria-invalid', 'true')
    expect(confirmation).toHaveAccessibleDescription(/não coincidem/i)
    expect(screen.getByLabelText(/^palavra-passe mestra$/i)).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('uses new-password autocomplete on both password fields', () => {
    renderPage()

    expect(screen.getByLabelText(/email/i)).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText(/^palavra-passe mestra$/i)).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText(/confirma a palavra-passe/i)).toHaveAttribute('autocomplete', 'new-password')
  })

  it('submits once the master password meets the minimum length', async () => {
    createAccount.mockResolvedValue(undefined)
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/^palavra-passe mestra$/i), 'a long master password')
    await userEvent.type(screen.getByLabelText(/confirma a palavra-passe/i), 'a long master password')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    await vi.waitFor(() => {
      expect(createAccount).toHaveBeenCalledWith('paulo@example.com', 'a long master password', 'pt-PT')
    })
  })

  // Review Focus 5: the language chosen in the auth layout's corner is the
  // account's locale — the reason that menu is on this screen at all.
  it('creates the account in the language chosen from the language menu', async () => {
    createAccount.mockResolvedValue(undefined)
    renderWithProviders(
      <AuthLayout>
        <SetupPage />
      </AuthLayout>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Idioma' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'English' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /set up your account/i })).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/^master password$/i), 'a long master password')
    await userEvent.type(screen.getByLabelText(/confirm master password/i), 'a long master password')
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await vi.waitFor(() => {
      expect(createAccount).toHaveBeenCalledWith('paulo@example.com', 'a long master password', 'en-GB')
    })
  })
})
```

- [ ] **Step 3: Run them and watch the new ones fail**

```bash
pnpm --filter @ledger-hq/web test -- SetupPage
```

Expected: FAIL — no intro text, no hint description, no `aria-invalid`. Two tests already pass and must stay green: `'submits once the master password meets the minimum length'` (unchanged behaviour) and `'creates the account in the language chosen from the language menu'` (Review Focus 5 — Tasks 3-4 already made it true; it is the regression guard for Task 4's layout plus this page).

- [ ] **Step 4: Implement**

Replace the whole of `apps/web/src/auth/SetupPage.tsx` with:

```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MIN_MASTER_PASSWORD_LENGTH } from '@ledger-hq/crypto'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Input } from '../ui'
import { createAccount } from './credentials'
import { SESSION_QUERY_KEY } from './session'

export function SetupPage() {
  const { t, i18n } = useTranslation('common')
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [masterPassword, setMasterPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const passwordsMismatch = confirmPassword.length > 0 && masterPassword !== confirmPassword
  // Argon2id's salt (the raw master password, in `deriveAuthHash`) throws
  // below 8 bytes — refuse before any derivation runs, the same way the
  // mismatch check above refuses before a submit.
  const passwordTooShort = masterPassword.length > 0 && masterPassword.length < MIN_MASTER_PASSWORD_LENGTH

  const mutation = useMutation({
    // The account's locale is whatever language is active at submit — which
    // is why the auth layout keeps the language menu on this screen.
    mutationFn: () => createAccount(email, masterPassword, i18n.language as 'pt-PT' | 'en-GB'),
    onSuccess: async () => {
      setMasterPassword('')
      setConfirmPassword('')
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
      await queryClient.invalidateQueries({ queryKey: ['bootstrap-required'] })
    },
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (passwordsMismatch || passwordTooShort) return
        mutation.mutate()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t('auth.setupTitle')}</h1>
        <p className="text-sm text-muted">{t('auth.setupIntro')}</p>
      </div>

      <Input
        type="email"
        autoComplete="username"
        required
        label={t('auth.emailLabel')}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <Input
        type="password"
        autoComplete="new-password"
        required
        label={t('auth.masterPasswordLabel')}
        hint={t('auth.passwordHint', { min: MIN_MASTER_PASSWORD_LENGTH })}
        value={masterPassword}
        onChange={(event) => setMasterPassword(event.target.value)}
        error={passwordTooShort ? t('auth.passwordTooShort', { min: MIN_MASTER_PASSWORD_LENGTH }) : undefined}
      />

      <Input
        type="password"
        autoComplete="new-password"
        required
        label={t('auth.confirmPasswordLabel')}
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        error={passwordsMismatch ? t('auth.passwordMismatch') : undefined}
      />

      <ErrorMessage error={mutation.error} />

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        isLoading={mutation.isPending}
        disabled={passwordsMismatch || passwordTooShort}
      >
        {t('actions.create')}
      </Button>
    </form>
  )
}
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- SetupPage RequireSession locales
pnpm --filter @ledger-hq/web i18n:check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/auth/SetupPage.tsx apps/web/src/auth/SetupPage.test.tsx apps/web/src/i18n/locales/pt/common.json apps/web/src/i18n/locales/en/common.json
git commit -m "$(cat <<'EOF'
feat(web): restyle account setup on the form controls

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Signed-out e2e, the guidelines' closing pass, and done

**Files:**
- Modify: `apps/web/e2e/shell.spec.ts`
- Modify: `docs/design/guidelines.md`
- Modify: `docs/design/roadmap.md` (Stage 5 status)

**Interfaces:**
- Consumes: everything above.
- Produces: the stage's definition of done.

- [ ] **Step 1: Write the signed-out e2e checks**

In `apps/web/e2e/shell.spec.ts`, add inside `test.describe('app shell', …)`, after the existing tests:

```ts
  // Signed out there is no shell: the sidebar and the tab bar are both
  // absent, not merely hidden. The unit tests prove the gate; this proves it
  // in the built app at both viewports, and that the URL survives sign-in.
  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'phone', width: 390, height: 844 },
  ]) {
    test(`shows only the auth card when signed out, then the shell on the same URL (${viewport.name})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/clients')

      // Sign-in, or account setup on a fresh install — see signIn() above.
      await expect(page.getByRole('heading', { level: 1, name: /^entrar$|configura a tua conta/i })).toBeVisible()
      await expect(page.getByRole('navigation')).toHaveCount(0)
      await expect(page.getByRole('searchbox')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /idioma/i })).toBeVisible()

      await page.getByLabel(/email/i).fill('paulo@example.com')
      await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
      const confirmPasswordField = page.getByLabel(/confirma/i)
      if (await confirmPasswordField.isVisible().catch(() => false)) {
        await confirmPasswordField.fill(MASTER_PASSWORD)
      }
      await page.getByRole('button', { name: /^criar$|^entrar$/i }).click()

      // The shell appears around the route the URL already named.
      await expect(page).toHaveURL(/\/clients$/)
      await expect(page.getByRole('heading', { level: 1, name: /clientes/i })).toBeVisible()
      // Both navs are in the DOM; the media query shows exactly one — the
      // sidebar on desktop, the tab bar on a phone. `.first()` alone would be
      // the sidebar, which is display:none at 390px.
      await expect(page.getByRole('navigation').filter({ visible: true })).toHaveCount(1)
    })
  }
```

The submit regex is anchored (`^criar$|^entrar$`) so it can only ever be the form's submit; the existing `signIn()` helper's looser `/criar|entrar/i` also matches only the submit on both cards ("Esqueceste a palavra-passe mestra?" and "Idioma" contain neither word) and is left alone.

- [ ] **Step 2: Run the e2e suite**

```bash
pnpm --filter @ledger-hq/web test:e2e
```

Expected: PASS, including `setup-and-clients.spec.ts`'s bootstrap path unchanged (spec §9). If the bootstrap path fails on a label, compare against Task 7's labels — they did not change; the failure is elsewhere.

One known fragility, not fixed here because the full suite never hits it: run **alone** against a fresh database, `offline.spec.ts` lands on account setup, whose intro ("…deste Ledger HQ…") makes its `getByText(/ledger hq/i)` match twice and fail strict mode. In suite order `billing.spec.ts` has already bootstrapped the account, so the offline reload shows sign-in. If it bites, raise it rather than loosening the assertion.

- [ ] **Step 3: Extend the guidelines and run the closing pass**

Stages 2-4 insert sections after §2 (Stage 2's Forms, Stage 3's Dialogs/Tabs/Toasts/Callouts/Amounts, Stage 4's Secrets on screen) and renumber everything below, so locate sections by **title**, not by today's numbers. In `docs/design/guidelines.md`, insert the section below immediately before "The rule about `ui/`" (the last section), give it that section's current number `N`, and renumber "The rule about `ui/`" to `N + 1`:

```markdown
## N. Signed-out screens

Sign-in, vault recovery and account setup render outside the shell, in
`auth/AuthLayout.tsx`: no sidebar, no tab bar, no search, no account menu
— none of them can do anything without a session. `RequireSession`
(`auth/RequireSession.tsx`) wraps the whole shell and chooses between the
splash, the auth layout and the shell; no route path is involved.

- **One card, one `<h1>`.** Each auth page renders its own heading block
  inside the card (`text-2xl` title, optional `text-sm text-muted`
  introduction). There is no `PageHeader` here — it is built for a page
  body with an action slot.
- **Language and connection are always reachable.** The auth layout's
  corner holds `ConnectionStatus` and `LanguageMenu`. Account setup records
  the active language as the account's locale.
- **The splash is the frame and the mark, nothing else.** `AuthFrame` is
  shared with the layout, so the mark does not move when the card or the
  shell replaces the splash.
- **Autocomplete tokens are exact**: `username` on the email,
  `current-password` to sign in, `new-password` wherever a password is
  being chosen. Password managers depend on them.
```

The spec (§11) files the formatting rule as a **forms pattern**, so it goes in Stage 2's "Forms" section, as a paragraph after the "Field errors are the form's one validation voice" paragraph:

```markdown
**Format structured codes as they are typed, idempotently.** The
recovery code field (`vault/recoveryCode.ts`) upper-cases, strips
anything outside the alphabet and re-inserts the hyphens on every
change, restoring the caret after the same code character it followed;
formatting a canonical value returns it unchanged. Never cap such a
field with `maxLength` — the browser truncates a paste before the
formatter can clean it; the formatter caps the code itself.
```

Then the closing pass the spec asks for (§11) — this is the last stage. Read each section of `docs/design/guidelines.md` against the code as it now stands and fix what drifted. Run the commands from the repository root (`cd /Users/pauloaraujo/Projects/personal/ledger-hq`).

1. "Tokens" (§1): every token in the table exists in `apps/web/src/styles.css`'s `@theme`, and every `@theme` colour is in the table.
   ```bash
   grep -o -- '--color-[a-z0-9-]*' apps/web/src/styles.css | sort -u
   ```
2. "Which component for which job" (§2): every component exported from `apps/web/src/ui/index.ts` is named in §2 or in a section a later stage added (Forms, Dialogs, Tabs, Toasts, Callouts, Amounts, Secrets on screen).
   ```bash
   grep -o 'export { [A-Za-z]*' apps/web/src/ui/index.ts
   ```
3. "Accessibility checklist": its Keyboard item (item 3) says "tab order runs sidebar → content → account menu" — still true signed in; append "Signed out, there is no sidebar: tab order runs language menu → the card's fields → submit."
4. "Status about the app" names its pill consumers (the connection indicator, the Vault page's lock state) — still accurate; the connection pill now also sits in the auth layout's header, which needs no change to the wording.
5. Every file path the document names still exists:
   ```bash
   grep -oE '`[A-Za-z0-9/_.-]+\.(tsx|ts|css)`' docs/design/guidelines.md | tr -d '`' | sort -u | while read -r f; do
     [ -e "apps/web/src/$f" ] || [ -e "apps/web/$f" ] || [ -e "$f" ] || echo "missing: $f"
   done
   ```
   Expected: no `missing:` lines. Fix any that print.

- [ ] **Step 4: Mark the stage shipped**

In `docs/design/roadmap.md`, under `## Stage 5 — Auth`, change `**Status:** specced.` to `**Status:** shipped.`, and add after its `[Spec]` line (as Stage 2 does for its own):

```markdown
- [Plan](../superpowers/plans/2026-10-04-ui-refresh-stage-5.md).
```

- [ ] **Step 5: Run the definition of done**

```bash
cd /Users/pauloaraujo/Projects/personal/ledger-hq
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @ledger-hq/web i18n:check
pnpm --filter @ledger-hq/web test:e2e
```

Expected: all green. Then open the app (`pnpm --filter @ledger-hq/web dev` against a running API), sign out, and compare sign-in, recovery, setup (on a fresh database) and the splash (throttle the network in devtools to see it) with the eight Auth boards from Task 1, at 1280×800 and 390×844. Where the browser and a board disagree, raise it rather than guessing which one is wrong.

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e/shell.spec.ts docs/design/guidelines.md docs/design/roadmap.md
git commit -m "$(cat <<'EOF'
test(web): prove the signed-out screens carry no shell

Adds the auth section to the design guidelines, checks the whole
document against what the five stages shipped, and marks Stage 5
shipped in the roadmap.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review against the spec

- §1 Ships — `AuthLayout` (Task 4), gate above the shell (Task 5), `LoginPage`/`SetupPage` restyled (Tasks 6, 7), splash (Task 4), recovery normalisation (Tasks 2, 6), `LanguageMenu` (Task 3), i18n keys (Tasks 4, 6, 7). Does-not-ship items: no route path, API or behaviour change in any task.
- §2 Decisions 1-5 — Tasks 5, 3+5, 2+6, 6+7, 6+7 respectively.
- §3 Boards — Task 1; compared in Task 8.
- §4.1-4.4 — Tasks 5, 4, 4, 3. The language trigger is the spec's ghost icon `Button` under Radix `asChild`; the offline first load is a unit test (Task 5, real `apiFetch` over a rejecting `fetch`) and `offline.spec.ts` in the browser.
- §5.1-5.4 — Tasks 6, 6, 7, 2. No `maxLength` on the recovery field (Review Focus 1).
- §7 i18n — all five keys; `pt` copy in the bundle's `tu` register (Global Constraints).
- §8 Accessibility 1-5 — one `<h1>` and no nav (Tasks 4, 5); autocomplete (Tasks 6, 7 tests); caret (Task 6 test); field errors (Tasks 6, 7); splash announces once (Task 4 test).
- §9 Testing — every listed test is in Tasks 2-8. `setup-and-clients.spec.ts`'s language test asserted a signed-out nav link and is rewritten in Task 5.
- §11 Guidelines — Task 8 Step 3: the signed-out section (layout, one card and one `<h1>`, language and connection, autocomplete tokens) and the code-formatting rule in the Forms section, located by title because Stages 2-4 renumber the document.
