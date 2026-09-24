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

A second pass drew every screen, desktop and mobile. That settled the
client detail page's layout (tabs), renamed the Platforms page to
Vault, and moved the credential unlock gate from Stage 4 to Stage 3.
The stages below already reflect it.

## Mockups

<https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92>

Fifteen artboards — every screen in a desktop and a mobile frame, plus
a board of the tokens and every Stage 1 component with its variants.
This is the editable source: iterate on that canvas rather than
starting a new one, and each stage's brainstorming pass starts by
opening its row.

| Row | Artboards | Stage |
|---|---|---|
| Overview | loaded, loading, empty + offline, mobile | 1 |
| System | tokens and components | 1 |
| Clients | list, detail, new-client form — desktop and mobile each | 2 and 3 |
| Vault | vault page, credentials locked and unlocked — desktop and mobile each | 3 and 4 |

The boards carry real data: obligation names from the fiscal catalog,
`en-GB` currency and dates as `src/i18n/format.ts` produces them, and
figures that reconcile across screens.

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
- **Nav rename**: the third sidebar item becomes **Vault**, not
  "Platforms" — a new `common:nav.vault` key. The route
  `/vault/platforms` and the `PlatformsPage` component keep their
  names.
- **New i18n keys** (five, both locales): `common:home.title`,
  `common:home.outstanding`, `common:nav.vault`,
  `obligations:dashboard.emptyHint`, `billing:receivables.emptyHint`.
- **Out of scope**: every other screen; dark mode; form controls
  (`HomePage` has no inputs).
- Full detail: [design spec](../superpowers/specs/2026-09-19-ui-refresh-design.md).

## Stage 2 — Clients list & form

**Status:** drawn, not specced.

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

**Status:** drawn, not specced.

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
- **New components** (first real usage): `Tabs` — the page's five
  sections; `Dialog` — the write-off reason prompt and the
  add-credential form, both of which are inline today and shouldn't
  be; `Toast` — copy-to-clipboard confirmation without a
  layout-shifting banner.
- **New dependencies**: `@radix-ui/react-tabs`,
  `@radix-ui/react-dialog`, `@radix-ui/react-toast`.
- **Layout, decided**: five tabs — Overview, Obligations, Billing,
  People, Credentials — with the page header (name, kind, tax number,
  archive/edit) above the tab strip. On mobile the strip scrolls
  horizontally. Each tab keeps its own query, so the page fetches only
  the active tab. See the design spec's decisions section for why tabs
  rather than an accordion or a split.
- **Also decided by the mockups**: a revealed credential shows a
  masked password plus Copy, never the plaintext, with the 30-second
  clipboard clear stated on screen; a written-off charge keeps its row
  but renders struck through and muted, with a `Written off` badge.
- **Still to resolve when brainstormed**: whether the five inline
  forms become dialogs uniformly or only where the interaction demands
  it; what the Obligations tab's per-client controls (adjust, waive,
  ad-hoc) look like once they are not competing with five other
  sections for the page.
- **Depends on**: Stage 1's `Money`/`DataList`/`Card`/`Badge`, and
  Stage 2's `Input`/`Select`/`Checkbox` for the five forms.

## Stage 4 — Vault page & setup

**Status:** drawn, not specced.

Applies the design system to the vault screens that live outside the
client detail page: the platform list (shown as **Vault** in the nav)
and first-run vault setup.

- **Screens**: `PlatformsPage`, `VaultSetupPage`.
- **Drawn already**: the vault page in both frames — platform rows
  carrying their authentication kind and credential count, the create
  form beside the list on desktop and below it on mobile, and a vault
  status pill ("Unlocked · locks after 15 min") in the header.
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
