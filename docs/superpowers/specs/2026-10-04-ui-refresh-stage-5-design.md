# UI refresh, Stage 5 — design specification

**Date:** 2026-10-04
**Status:** proposed
**Parent:** [UI refresh design](./2026-09-19-ui-refresh-design.md) ·
[roadmap](../../design/roadmap.md) ·
[Stage 2](./2026-10-04-ui-refresh-stage-2-design.md) ·
[Stage 4](./2026-10-04-ui-refresh-stage-4-design.md) ·
[screens](https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92)

Stage 5 applies the design system to the screens seen without a session:
sign-in, vault recovery (a mode of the sign-in page) and first-run
account setup. It is last because it is the least-seen screen and
nothing depends on it. Its one structural change is that these screens
stop rendering inside the app shell.

## 1. Scope

**Ships:**

- `auth/AuthLayout.tsx`: a standalone, centred layout for signed-out
  screens — mark, card, language menu, connection pill.
- The session gate moves above the shell: without a session, no
  sidebar, no tab bar, no search box and no account menu render.
- `auth/LoginPage.tsx` (sign-in and recovery modes) and
  `auth/SetupPage.tsx` restyled on Stage 2's form controls.
- A loading splash in place of today's blank screen while the session
  resolves.
- The recovery code field accepts the code however it is typed.
- `shell/LanguageMenu.tsx`, extracted so the auth layout and the account
  menu share one language control.
- New i18n keys (§7), both locales.

**Does not ship:**

- Any route change. `/` still renders the sign-in page when there is no
  session, exactly as today; only what surrounds it changes.
- A password visibility toggle, "remember me", or any other new auth
  behaviour.
- Any API change.

## 2. Decisions

1. **Signed-out screens get their own layout, outside the shell.** Today
   `RequireSession` wraps only the shell's `<Outlet />`, so the sign-in
   form renders beside a working sidebar: four nav links that each lead
   back to the sign-in form, a search box that searches nothing, and an
   account menu with only a language choice. The gate moves up to wrap
   the whole shell (§4.1). This is a layout change, not a routing one.
2. **The language choice stays reachable before sign-in** — it is the
   one control someone may need first, and account setup records the
   active language as the account's locale. It moves from the account
   menu's signed-out variant to a `LanguageMenu` in the auth layout's
   corner. With no signed-out rendering left, the account menu loses its
   signed-out branch.
3. **The recovery code is normalised as it is typed.** Recovery derives
   keys from the code's exact string, and the generator's form is
   upper-case base32 in hyphenated groups of five. Typed in lower case,
   with spaces, or without hyphens, today's field fails with "wrong
   code" for a code that is right. The field upper-cases, drops every
   character outside the base32 alphabet, and re-inserts the hyphens, so
   what is submitted is always the canonical string. It changes no rule:
   any input that worked before produces the same string.
4. **Validation messages become field errors.** "Too short" belongs to
   the password field and "do not match" to the confirmation field,
   through Stage 2's `error` prop, instead of paragraphs under the form.

## 3. Visual reference

No board exists for any auth screen. Drawing them is the plan's first
task: sign-in, recovery and account setup, each desktop and mobile, plus
the splash — eight boards. This section describes them; once drawn, the
boards outrank it where they disagree.

## 4. Structure

### 4.1 The session gate

Today:

```
rootRoute → AppLayout
              Sidebar · MobileTopBar · <main><RequireSession><Outlet/></RequireSession></main> · MobileTabBar
```

Target:

```
rootRoute → Root
              RequireSession
                ├ pending            → <AuthSplash />
                ├ bootstrap required → <AuthLayout><SetupPage /></AuthLayout>
                ├ no session         → <AuthLayout><LoginPage /></AuthLayout>
                └ signed in          → <AppLayout />   (shell + <Outlet />)
```

- `RequireSession` moves from `router.tsx` to `auth/RequireSession.tsx`
  and takes the decision logic unchanged: bootstrap first, then the
  session. Its `null` while pending becomes `AuthSplash`.
- `AppLayout` no longer contains `RequireSession`; it can assume a
  session. `useVaultSync()` stays in `AppLayout` and so now runs only
  when signed in — it already did nothing without a session.
- The Stage 3 `ToastProvider` stays in `AppLayout`; nothing signed-out
  toasts.
- After sign-in, `RequireSession` re-renders on the session query's
  invalidation, as today, and the shell appears around whatever route
  the URL names — a bookmarked `/clients` lands on the client list
  after sign-in.

### 4.2 `auth/AuthLayout.tsx`

```tsx
<div className="flex min-h-dvh flex-col bg-ground text-ink">
  <header className="flex justify-end gap-2 p-4">
    <ConnectionStatus />
    <LanguageMenu />
  </header>
  <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-[8vh] md:items-center md:pt-0">
    <div className="flex w-full max-w-sm flex-col items-center gap-6">
      <Mark /> {/* the sidebar's "L" square at 40px, then the app name */}
      <Card className="w-full">{children}</Card>
    </div>
  </main>
</div>
```

- The mark and app name are the sidebar's, larger, so the shell that
  appears after sign-in is visibly the same product.
- `ConnectionStatus` renders here too: signing in offline fails, and the
  pill says why before the error does. It is unchanged — it already
  returns `null` online.
- On mobile the card starts near the top (`pt-[8vh]`) rather than
  centring, so the on-screen keyboard does not push the submit button
  out of view; from `md` it centres vertically.
- Each page renders its own heading inside the card: an `<h1>` at
  `text-xl font-semibold`, plus an optional `text-sm text-muted`
  introduction. No `PageHeader` — it is built for a page body with an
  action slot, not a card.

### 4.3 `auth/AuthSplash.tsx`

The mark at the same size and position as in `AuthLayout`, on
`bg-ground`, with `aria-busy="true"` and a visually hidden
`common:loading`. No spinner and no skeleton: the session check is
usually a few milliseconds, and a static mark that the sign-in card or
the shell then replaces reads as one continuous screen rather than a
flash.

### 4.4 `shell/LanguageMenu.tsx`

A `DropdownMenu` whose trigger is a `ghost` icon `Button` (`Languages`,
`aria-label={t('language.label')}`) and whose content is the language
`RadioGroup` over `SUPPORTED_LOCALES` calling `setLocale`. The radio
group itself is extracted as `LanguageRadioItems` and rendered by both
`LanguageMenu` and `AccountMenu`, so the language list exists once.
`AccountMenu` drops `signedIn` and its signed-out trigger: it is only
ever rendered inside the shell now.

## 5. Screens

### 5.1 Sign in — `LoginPage.tsx`, mode `login`

- `<h1>` `common:auth.loginTitle`.
- `Input type="email" autoComplete="username"` — `auth.emailLabel`.
- `Input type="password" autoComplete="current-password"` —
  `auth.masterPasswordLabel`, `error` = `auth.passwordTooShort` while
  the typed value is shorter than `MIN_MASTER_PASSWORD_LENGTH` (the
  same condition as today).
- `ErrorMessage` for the mutation.
- `Button variant="primary" type="submit" isLoading` —
  `common:actions.signIn`, full width.
- `Button variant="ghost" size="sm"` — `auth.forgotPassword`, centred
  under the submit, switching to recovery mode.

### 5.2 Recovery — `LoginPage.tsx`, mode `recover`

- `<h1>` `auth.recoverTitle`, introduction `auth.recoverIntro`.
- Recovery code: `Input` with `font-mono tracking-wider`,
  `autoComplete="off"`, `spellCheck={false}`,
  `autoCapitalize="characters"`, `hint={t('auth.recoveryCodeHint')}`.
  Its `onChange` passes the text through `formatRecoveryCode` (§5.4)
  before storing it.
- New master password, `autoComplete="new-password"`, `error` =
  `passwordTooShort`.
- Confirmation, `autoComplete="new-password"`, `error` =
  `passwordMismatch`.
- `ErrorMessage`; `Button variant="primary" type="submit" isLoading`
  `auth.recoverButton`, full width; `Button variant="ghost" size="sm"`
  `auth.backToLogin`.
- On success, unchanged: fields cleared, back to `login` mode, session
  invalidated.

### 5.3 Account setup — `SetupPage.tsx`

- `<h1>` `auth.setupTitle`, introduction `auth.setupIntro`.
- Email, master password (`autoComplete="new-password"`,
  `hint={t('auth.passwordHint', { min })}`, `error` = too short),
  confirmation (`error` = mismatch).
- `ErrorMessage`; `Button variant="primary" type="submit" isLoading`
  `common:actions.create`, full width.
- The account's locale is still `i18n.language` at submit — which is
  why the language menu must be on this screen.

### 5.4 `vault/recoveryCode.ts`

```ts
/** Upper-cases, keeps only base32 characters, and groups them in fives with hyphens. */
export function formatRecoveryCode(text: string): string
```

- `toUpperCase()`, then remove everything outside `[A-Z2-7]`, cap at 26
  characters, then join groups of five with `-`.
- Idempotent: formatting a canonical code returns it unchanged, so a
  pasted code is untouched.
- Lives in `vault/` beside `recover.ts`, not in `auth/`: the code's shape
  is the vault's (it mirrors `generateRecoveryCode` in
  `@ledger-hq/crypto`), and the test asserts the round trip against the
  generator itself.
- The field's `maxLength` is 31 (26 characters, 5 hyphens).

## 6. File layout

```
apps/web/src/
  auth/
    RequireSession.tsx   moved from router.tsx; splash instead of null (new file)
    AuthLayout.tsx       (new)
    AuthSplash.tsx       (new)
    LoginPage.tsx        restyled, both modes
    SetupPage.tsx        restyled
  shell/
    AppLayout.tsx        no longer gates; assumes a session
    AccountMenu.tsx      signed-out branch removed; uses LanguageRadioItems
    LanguageMenu.tsx     (new) LanguageMenu + LanguageRadioItems
  vault/
    recoveryCode.ts      (new) formatRecoveryCode
  router.tsx             root component becomes Root (RequireSession → AppLayout)
```

## 7. i18n

| Key | `pt-PT` | `en-GB` |
|---|---|---|
| `common:loading` | A carregar | Loading |
| `common:auth.recoverIntro` | Use o código de recuperação que anotou ao configurar o cofre. Escolha a seguir uma nova palavra-passe mestra. | Use the recovery code you wrote down when you set up the vault, then choose a new master password. |
| `common:auth.recoveryCodeHint` | Seis grupos de letras e números, por exemplo ABCDE-FGHIJ-… | Six groups of letters and digits, such as ABCDE-FGHIJ-… |
| `common:auth.setupIntro` | Esta é a única conta deste Ledger HQ. A palavra-passe mestra serve para entrar e para cifrar o cofre — escolha uma de que se lembre. | This is the only account on this Ledger HQ. The master password signs you in and encrypts the vault, so choose one you will remember. |
| `common:auth.passwordHint` | Pelo menos {{min}} caracteres. | At least {{min}} characters. |

Every other label exists in `common:auth.*` and `common:actions.*`.
No key is removed: the account menu's signed-out trigger used
`common:language.label`, which `LanguageMenu` now uses.

## 8. Accessibility

1. Each auth screen has exactly one `<h1>`, inside the card; there is no
   nav landmark when signed out, and the `<main>` holds only the card.
2. Autocomplete tokens are exact (`username`, `current-password`,
   `new-password`) so password managers fill the right fields.
3. The recovery field's normalisation never moves the caret
   unexpectedly when typing at the end; when editing in the middle, the
   caret is restored to the same character index after formatting. If
   that proves fragile, typing in the middle is the rare case and the
   field still submits the right string.
4. Field errors follow Stage 2's contract: announced, linked by
   `aria-describedby`, never colour alone.
5. The splash announces loading once (`aria-busy` and hidden text), not
   repeatedly.

## 9. Testing

**New:**

- `vault/recoveryCode.test.ts` — lower case, spaces, missing hyphens
  and stray characters all normalise to the canonical form; a canonical
  code is unchanged; a fresh `generateRecoveryCode()` is a fixed point;
  input past 26 characters is capped.
- `auth/RequireSession.test.tsx` — pending renders the splash;
  bootstrap-required renders setup inside the auth layout; no session
  renders sign-in with no `navigation` landmark in the document; a
  session renders the shell.
- `shell/LanguageMenu.test.tsx` — opening it and choosing a language
  calls `setLocale`.

**Updated:**

- `auth/LoginPage.test.tsx` — too-short is now the password field's
  error (`role="alert"`, `aria-describedby`); recovery submits the
  normalised code when typed in lower case without hyphens.
- `auth/SetupPage.test.tsx` — mismatch is the confirmation field's
  error; the minimum-length hint is shown.
- `shell/AppLayout.test.tsx` — the sign-out case now asserts the
  sign-in heading appears *and* the sidebar is gone; tests that rendered
  `AppLayout` signed-out move to `RequireSession.test.tsx`.
- `shell/AccountMenu.test.tsx` — the signed-out variant's cases are
  deleted with the branch; language switching is still covered through
  the shared radio items.

**End-to-end:** `e2e/shell.spec.ts` gains a signed-out check at both
viewports — the sign-in card is visible and no nav (sidebar or tab bar)
is; after sign-in the shell appears on the same URL.
`e2e/setup-and-clients.spec.ts`'s bootstrap path must pass unchanged
against the new layout.

**Definition of done:** the full suite, `i18n:check` and e2e green; the
eight new boards match the browser at 1280×800 and 390×844.

## 10. Risks

- **Moving the gate changes every test that renders the shell
  signed-out.** Expected and contained: those tests move to
  `RequireSession.test.tsx`. Any other test that starts failing is a
  regression.
- **Flash of the splash.** If the session check is slow (a cold
  service worker, a slow link), the splash shows for longer; that is
  the point of it. If it is instant, the splash is never seen.
- **The recovery formatter is the one place this stage touches a
  secret's input.** It must never change a valid code; the fixed-point
  test against the real generator is what guarantees it.

## 11. Guidelines document

`docs/design/guidelines.md`: an **Auth layout** note (signed-out
screens render outside the shell; one card, one `<h1>`, language and
connection always reachable), the autocomplete-token rule, and "format
structured codes as they are typed, idempotently" as a forms pattern.
This is the last stage; the guidelines document's closing pass checks
every section against what all five stages shipped.
