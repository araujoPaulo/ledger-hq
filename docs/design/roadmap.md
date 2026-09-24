# UI refresh — roadmap

**Status:** approved (see [design spec](../superpowers/specs/2026-09-19-ui-refresh-design.md))
**Branch:** `design/ui-refresh`
**Last revised:** 2026-09-24

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

## Revision — 2026-09-24

The original four-stage map predated Phase 3 (Billing). Two of its
assumptions no longer hold:

- **The post-login screen changed.** `/` renders `HomePage`, which
  composes `ObligationsDashboard` with the new `ReceivablesSection`.
  Stage 1 now covers that whole page, not the dashboard alone.
- **The client detail page grew from two sections to five**, spanning
  four features (fiscal profile, obligations, billing ledger,
  employments, vault credentials). Folding all of that into the
  clients stage would have made one stage larger than the other three
  combined, so it splits out as its own stage.

Net effect: four stages become five, and the component library gains
`Money` and `DataList`. `Dialog` and `Toast` move from "installed
unused in Stage 1" to "added in Stage 3, where they have consumers".

## Stage 1 — App shell & HomePage

**Status:** design complete, implementation plan next.

Establishes the design system itself: tokens (`@theme` in
`styles.css`), the `apps/web/src/ui/` component library, and applies
both to the app shell (`AppLayout`) and the whole `HomePage` — the
screen seen immediately after login.

- **New components**: `Button`, `Badge`, `Card`, `EmptyState`,
  `Skeleton`, `PageHeader`, `DropdownMenu`, `Money`, `DataList`.
- **New dependencies**: `@radix-ui/react-dropdown-menu`,
  `class-variance-authority`, `lucide-react`, `@fontsource/inter`.
- **Screens touched**: `apps/web/src/shell/AppLayout.tsx`,
  `apps/web/src/HomePage.tsx`,
  `apps/web/src/obligations/ObligationsDashboard.tsx`,
  `apps/web/src/billing/ReceivablesSection.tsx`.
- **Out of scope**: every other screen; dark mode; form controls
  (`HomePage` has no inputs).
- Full detail: [design spec](../superpowers/specs/2026-09-19-ui-refresh-design.md).

## Stage 2 — Clients list & form

**Status:** not designed yet.

Applies the design system to client management's standalone screens:
the list with its filter bar, and the create/edit form.

- **Screens**: `ClientListPage`, `ClientFormPage`.
- **New components** (first real usage): `Input`, `Select`,
  `Checkbox` — the filter bar (search + kind + archived toggle) and
  the client form are where the system first needs real form controls
  with label and error states. `ClientFormPage` is the largest file in
  the app at 336 lines, which makes it the honest test of whether the
  form primitives are good enough.
- **New dependencies**: `@radix-ui/react-select`,
  `@radix-ui/react-checkbox`.
- **Depends on**: Stage 1's tokens and `Button`/`Card`/`Badge`/`PageHeader`.

## Stage 3 — Client detail page

**Status:** not designed yet.

Applies the design system to `ClientDetailPage` and every section
composed into it. This is the densest screen in the app and the one
where the refresh has the most to prove.

- **Screens**: `ClientDetailPage` plus `FiscalProfileForm`,
  `ObligationsSection` (with `AddAdHocObligationForm` and
  `AdjustObligationForm`), `ClientLedgerSection` (with
  `RetainerPlanForm`, `RecordPaymentForm`, `AddAdHocChargeForm`),
  `EmploymentSection` (with `AddEmploymentForm`), and
  `CredentialsSection` (with `AddCredentialForm`, `CredentialRow`, and
  `VaultUnlockGate` — the gate renders inside this section, not as a
  standalone screen, so it is styled here rather than in Stage 4).
- **New components** (first real usage): `Dialog` — the write-off
  reason prompt and the add-credential form, both of which are inline
  today and shouldn't be; `Toast` — copy-to-clipboard confirmation
  without a layout-shifting banner.
- **New dependencies**: `@radix-ui/react-dialog`,
  `@radix-ui/react-toast`.
- **The stage's central design question**: the page currently stacks
  six sections, five of which load independently, in a single scroll.
  Tabs, an accordion, or a two-column split are all plausible; that
  decision is what this stage's brainstorming pass is for, and it must
  be settled before any section is restyled.
- **Other questions to resolve when brainstormed**: whether credential
  values ever render inline (security-sensitive — probably not) or
  only copy-to-clipboard from a masked row; how the ledger presents a
  written-off charge next to a live one; whether the five inline forms
  become dialogs uniformly or only where the interaction demands it.
- **Depends on**: Stage 1's `Money`/`DataList`/`Card`/`Badge`, and
  Stage 2's `Input`/`Select`/`Checkbox` for the five forms.

## Stage 4 — Vault standalone screens

**Status:** not designed yet.

Applies the design system to the vault screens that live outside the
client detail page.

- **Screens**: `PlatformsPage`, `VaultSetupPage`.
- **New components**: none — `Dialog`, `Toast`, and the form controls
  all exist by this point.
- **Likely design questions**: how vault setup's recovery-code display
  and confirmation step reads with the new typography, given it is the
  one screen whose content a user is expected to copy down by hand.
- **Depends on**: Stage 2's `Input`, Stage 3's `Dialog`/`Toast` and the
  unlock-gate error styling settled there.

## Stage 5 — Auth

**Status:** not designed yet.

Applies the design system to login and first-run setup.

- **Screens**: `LoginPage`, `SetupPage`.
- **New components**: none.
- **Ordered last** because it is the least-frequently-seen screen
  (once per session) and has no new-component dependency forcing it
  earlier; moving it earlier would not unblock anything else.
- **Depends on**: Stage 2's `Input`.

## Sequencing

```
Stage 1 (tokens + shell + HomePage)
   │
   └─→ Stage 2 (Clients list & form) ── introduces Input/Select/Checkbox
           │
           ├─→ Stage 3 (Client detail) ── introduces Dialog/Toast
           │       │
           │       └─→ Stage 4 (Vault standalone) ── reuses Dialog/Toast
           │
           └─→ Stage 5 (Auth) ── reuses Input, no new components
```

Stage 2 gates everything after it, because every remaining screen has
a form on it. Stage 3 gates Stage 4 only through `Dialog`/`Toast`;
Stage 5 depends on Stage 2 alone and could run any time after it, but
is placed last because it is the screen users see least.

Stage 3 is deliberately the third stage rather than the second even
though the client detail page is high-traffic: its five forms all need
`Input`/`Select`/`Checkbox`, and those primitives are better shaped
against the two standalone client screens first, where a mistake
affects one form instead of five.

## Guidelines document

`docs/design/guidelines.md` is written once real components exist to
document — starting alongside Stage 1's implementation, then extended
as each later stage adds components or patterns not covered yet.
