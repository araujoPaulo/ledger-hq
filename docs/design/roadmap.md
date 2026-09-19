# UI refresh — roadmap

**Status:** approved (see [design spec](../superpowers/specs/2026-09-19-ui-refresh-design.md))
**Branch:** `design/ui-refresh`

This tracks the stages of the UI refresh initiative from the design
spec's rollout plan, in enough detail to plan and review each one
independently. Stages are named "Stage N" (not "Phase N") to avoid
colliding with the product's own phase numbering (Phase 0 Foundation,
Phase 1 Vault, Phase 2 Obligations, Phase 3 Billing) — the UI refresh
cuts across those phases rather than being one of them.

Each stage gets its own brainstorming pass and its own implementation
plan when its turn comes; only Stage 1 is planned in detail right now.
Later stages are sized and scoped here so the shape of the shared
component library is visible up front, not so they can be implemented
without going through design review first.

## Stage 1 — App shell & Obligations Dashboard

**Status:** design complete, implementation plan next.

Establishes the design system itself: tokens (`@theme` in
`styles.css`), the `apps/web/src/ui/` component library, and applies
both to the app shell (`AppLayout`) and the Obligations Dashboard —
the screen seen immediately after login.

- **New components**: `Button`, `Badge`, `Card`, `EmptyState`,
  `Skeleton`, `PageHeader`, `DropdownMenu`. `Dialog` and `Toast`
  primitives are added but unused this stage (first real consumer is
  Stage 3).
- **New dependencies**: `@radix-ui/react-dialog`,
  `@radix-ui/react-dropdown-menu`, `@radix-ui/react-select`,
  `@radix-ui/react-checkbox`, `@radix-ui/react-toast`,
  `class-variance-authority`, `lucide-react`, `@fontsource/inter`.
- **Screens touched**: `apps/web/src/shell/AppLayout.tsx`,
  `apps/web/src/obligations/ObligationsDashboard.tsx`.
- **Out of scope**: every other screen; dark mode; `Input`/`Select`/
  `Checkbox` components (no form on either target screen).
- Full detail: [design spec](../superpowers/specs/2026-09-19-ui-refresh-design.md).

## Stage 2 — Clients

**Status:** not designed yet.

Applies the design system to client management: list, detail, create/edit
form, and the fiscal-profile sub-form.

- **Screens**: `ClientListPage`, `ClientDetailPage`, `ClientFormPage`,
  `FiscalProfileForm`, `AddEmploymentForm`/`EmploymentSection`.
- **New components** (first real usage, not just added as primitives):
  `Input`, `Select`, `Checkbox` — the current filter bar and forms on
  these pages are the first places the design system needs real form
  controls with label/error states.
- **Likely design questions to resolve when this stage is
  brainstormed**: how the client list's filter bar (search + kind +
  archived toggle) restyles with the new `Input`/`Select`/`Checkbox`;
  whether the detail page gains a tabbed layout (profile / employments
  / vault credentials for that client) or stays a single scroll: the
  page has grown three sub-sections since it was first built.
- **Depends on**: Stage 1's tokens and `Button`/`Card`/`Badge`/`PageHeader`.

## Stage 3 — Vault

**Status:** not designed yet.

Applies the design system to the credential vault: platform list,
credential list, unlock gate, and vault setup/recovery.

- **Screens**: `PlatformsPage`, `CredentialsSection`, `AddCredentialForm`,
  `CredentialRow`, `VaultUnlockGate`, `VaultSetupPage`.
- **New components** (first real usage): `Dialog` (add/view a
  credential without leaving the list — currently an inline form),
  `Toast` (confirm "copied to clipboard" without a layout-shifting
  banner).
- **Likely design questions**: whether credential values ever render
  inline (security-sensitive — probably not) or only copy-to-clipboard
  from a masked row; how the unlock gate's error states (wrong
  password vs. offline vs. locked) map to the new form/alert styling.
- **Depends on**: Stage 1's tokens; Stage 2's `Input`/`Select` for the
  add-credential and add-platform forms.

## Stage 4 — Auth

**Status:** not designed yet.

Applies the design system to login, first-run setup, and vault
recovery-code account recovery.

- **Screens**: `LoginPage`, `SetupPage`.
- **New components**: none — by this stage every primitive it needs
  (`Input`, `Button`, `Card`) already exists from Stages 1-3.
- **Ordered last** because it's the least-frequently-seen screen (once
  per session) and has no new-component dependency forcing it earlier;
  moving it earlier would not unblock anything else.
- **Depends on**: Stage 2's `Input` (the only new primitive it
  consumes that doesn't already exist after Stage 1).

## Sequencing

```
Stage 1 (tokens + shell + dashboard)
   │
   ├─→ Stage 2 (Clients) ── introduces Input/Select/Checkbox
   │       │
   │       ├─→ Stage 3 (Vault) ── introduces Dialog/Toast, reuses Input/Select
   │       │
   │       └─→ Stage 4 (Auth) ── reuses Input, no new components
```

Stages 2-4 are not strictly required to run in this order — Vault and
Auth don't depend on each other, only on Stage 2's `Input`/`Select`
existing — but this is the intended order because Clients is the
highest-traffic screen after the dashboard, and doing it second means
the form primitives get battle-tested against three different forms
(client, fiscal profile, employment) before Vault and Auth reuse them.

## Guidelines document

`docs/design/guidelines.md` is written once real components exist to
document — starting alongside Stage 1's implementation, then extended
as each later stage adds components or patterns not covered yet.
