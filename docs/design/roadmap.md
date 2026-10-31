# UI refresh — roadmap

**Status:** approved (see [design spec](../superpowers/specs/2026-09-19-ui-refresh-design.md))
**Branch:** `design/ui-refresh`
**Last revised:** 2026-10-04

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

## Revision — 2026-10-04

Stage 1 shipped. Stages 2-5 are now specced, each in its own document,
and the stage sections below are reduced to a summary plus a link —
the specs are the contract. Brainstorming them against the code as it
stands after Phase 4 changed five things the earlier map assumed:

- **Phase 4b's search box and reporting date range** were shipped as
  plain inputs on purpose, for Stage 2 to adopt alongside the client
  filter bar. Stage 2 now lists them.
- **`Select` and `Checkbox` are native, styled**, not Radix — so
  `@radix-ui/react-select` and `@radix-ui/react-checkbox` are never
  added. Stage 2's only new dependency is `@radix-ui/react-slot`.
- **Client edit is in scope** (Stage 2): the detail mockup draws an Edit
  button and `PATCH /clients/:id` already exists.
- **Stage 3 adds two components the map did not name**: `Callout`
  (section-state messages) and `MoneyInput` (amounts typed in euros
  instead of cents).
- **Stage 5 moves signed-out screens out of the shell** — today the
  sign-in form renders beside a working sidebar.

The mockups also disagree with the code in three places the specs
resolve in the code's favour: the vault locks after 5 minutes, not 15;
the API has no per-platform credential count; the ledger has no
open/settled state per charge.

## Stage 1 — App shell & HomePage

**Status:** shipped.

Tokens, the `apps/web/src/ui/` library (`Button`, `Badge`, `Card`,
`EmptyState`, `Skeleton`, `PageHeader`, `DropdownMenu`, `Money`,
`DataList`), the shell and the whole `HomePage`.
[Spec](../superpowers/specs/2026-09-24-ui-refresh-stage-1-design.md) ·
[plan](../superpowers/plans/2026-09-24-ui-refresh-stage-1.md).

## Stage 2 — Clients list & form

**Status:** shipped.

Form controls `Input`, `Textarea`, `Select`, `Checkbox` (native,
styled) on one internal `Field`; `Button asChild`. Applied to
`ClientListPage` and `ClientFormPage`, which splits to serve **create
and edit** (new route `/clients/$clientId/edit`). Also adopts `Input`
in `SearchBox` and `PeriodSummaryReport`.

- **New dependency**: `@radix-ui/react-slot`.
- **Depends on**: Stage 1.
- [Spec](../superpowers/specs/2026-10-04-ui-refresh-stage-2-design.md).
- [Plan](../superpowers/plans/2026-10-04-ui-refresh-stage-2.md).

## Stage 3 — Client detail page

**Status:** specced.

`ClientDetailPage` as a header plus five URL-backed tabs (Overview,
Obligations, Billing, People, Credentials), every composed section and
form restyled, every form in a `Dialog` launched from a button.
Amounts typed in euros through `MoneyInput`. `ObligationRow` restyled
(shared with the dashboard). Includes `ObligationAttachments` and
`ApplyCreditForm` from Phase 4.

- **New components**: `Tabs`, `Dialog`, `Toast`, `Callout`,
  `MoneyInput`; `DataList` gains `as="dl"`.
- **New dependencies**: `@radix-ui/react-tabs`,
  `@radix-ui/react-dialog`, `@radix-ui/react-toast`.
- **Depends on**: Stage 2's form controls.
- [Spec](../superpowers/specs/2026-10-04-ui-refresh-stage-3-design.md).

## Stage 4 — Vault page & setup

**Status:** specced.

`PlatformsPage` (titled Vault, with a status pill and a New platform
dialog) and `VaultSetupPage` (two steps; the recovery code grouped for
transcription, with copy-and-clear). No new components. Vault recovery
moves to Stage 5 — it is a mode of the sign-in page.

- **Depends on**: Stage 3's `Dialog`, `Toast`, `Callout` and
  `PlatformAvatar`.
- [Spec](../superpowers/specs/2026-10-04-ui-refresh-stage-4-design.md).

## Stage 5 — Auth

**Status:** specced.

A standalone `AuthLayout` outside the shell for sign-in, recovery and
account setup; the session gate moves above the shell; a splash
replaces the blank screen while the session resolves; the recovery code
field normalises what is typed. No new components.

- **Depends on**: Stage 2's form controls.
- [Spec](../superpowers/specs/2026-10-04-ui-refresh-stage-5-design.md).

## Sequencing

```
Stage 1 (tokens + shell + HomePage)
   │
   └─→ Stage 2 (Clients list & form) ── introduces Input/Select/Checkbox
           │
           ├─→ Stage 3 (Client detail) ── introduces Tabs/Dialog/Toast/Callout/MoneyInput
           │       │
           │       └─→ Stage 4 (Vault standalone) ── reuses Dialog/Toast/Callout
           │
           └─→ Stage 5 (Auth) ── reuses Input, no new components
```

Stage 2 gates everything after it, because every remaining screen has
a form on it. Stage 3 gates Stage 4 only through `Dialog`/`Toast`/`Callout`;
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
