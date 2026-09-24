# UI refresh — design specification

**Date:** 2026-09-19 (revised 2026-09-24)
**Branch:** `design/ui-refresh`
**Status:** proposed

## Revision note — 2026-09-24

This spec was written before Phase 3 (Billing) merged. Billing changed
the two things the original Stage 1 rested on: the post-login screen is
no longer the Obligations Dashboard but a `HomePage` composing that
dashboard with a new receivables section, and the client detail page
grew from two sections to five, spanning four features. The stage map
below replaces the original four stages with five, and the component
library gains `Money` and `DataList`. Everything else — tokens,
non-goals, the accessibility and i18n rules — is unchanged from the
original.

## Problem

The web app (`apps/web`) works but has no visual design: raw Tailwind
utility classes copy-pasted per page, no shared component library, no
design tokens beyond Tailwind's defaults, no loading states (queries
in the `pending` state render `null` — a blank screen), and empty
states are a single line of grey text. There is no dark mode, no
consistent spacing rhythm, and no icon usage anywhere. The result is
functional but reads as a prototype, not a product a practice would
want to open every day.

Billing made this worse in a specific way: money is now rendered in
four places with four different treatments. A credit in the client
ledger is a raw `text-green-700` span; a receivable amount is
`font-medium` with no alignment; the ledger balance is a bespoke
bordered footer row; ageing buckets are `rounded bg-slate-100 px-2`
pills that are badges in everything but name.

## Goals

- Establish a small, reusable design system (tokens + components) that
  every future screen builds from, instead of each page inventing its
  own Tailwind combination.
- Apply it first to the app shell and the whole `HomePage` — the two
  surfaces every session starts with — to prove the system and deliver
  visible value quickly.
- Give money a single presentation across every screen that shows it,
  so a credit, a debit, and a written-off charge are distinguishable at
  a glance and consistently so.
- Leave every other screen on the current styling for now; each gets
  its own stage, with its own brainstorming pass and spec.

## Non-goals

- Dark mode. Tokens are structured so it can be added later without
  rework, but no stage implements it. The refresh already spans five
  stages; a second axis — every component reviewed in two themes —
  doubles the review surface of each one.
- A new shared `packages/ui` workspace package. Only `apps/web`
  consumes the design system; a separate package would be an
  abstraction with a single consumer. The component library lives at
  `apps/web/src/ui/`.
- A generic `Table` primitive. Every tabular surface in the app today
  (ledger entries, receivables, the client detail `<dl>`) is two
  columns: a label and a value. `DataList` covers all three. A real
  table with per-column alignment and a header row is built when a
  screen needs a third column, not before.
- Changing any backend/API contract, routing structure, or business
  logic. This is a presentation-layer change only.

## Design tokens

Defined via Tailwind v4's CSS-first `@theme` block in
`apps/web/src/styles.css` (no `tailwind.config.js` — the project
already uses the CSS-first v4 setup).

- **Color**: a neutral gray-blue scale (replaces ad-hoc `slate-*`
  usage) plus one accent scale, indigo, `50`→`900`. Semantic aliases
  on top: `success` (green), `warning` (amber), `danger` (red) — used
  for obligation urgency, ageing buckets, and form validation, not as
  raw Tailwind color classes sprinkled through components.
- **Typography**: Inter, self-hosted via `@fontsource/inter` (the app
  is self-hosted and reached over Tailscale; no dependency on a
  Google Fonts CDN at runtime). Scale: `text-xs` through `text-2xl`.
  Two weights only: `medium` (default) and `semibold` (headings/emphasis).
  Inter's tabular-figure feature (`font-variant-numeric: tabular-nums`)
  is exposed as a token and used by `Money` so amounts in a column
  align on the decimal.
- **Spacing**: Tailwind's default 4px scale, but component code
  standardizes on three gaps — `gap-4` (tight, within a control
  group), `gap-6` (default, between elements in a section), `gap-8`
  (between sections on a page).
- **Radius/elevation**: `rounded-lg` (8px) on cards, inputs, and
  buttons that aren't icon-only; `rounded-md` (6px) on small/icon
  buttons. Shadow is reserved for things that float above content
  (dropdown menus, dialogs, toasts) — static cards stay flat, borders
  only. This is what keeps the "minimal" read instead of drifting into
  skeuomorphic card piles.
- **Icons**: `lucide-react`. Tree-shakeable, pairs with Radix
  visually and license-wise (MIT, no attribution burden).

## Component library — `apps/web/src/ui/`

Radix UI primitives underneath for accessibility (focus management,
keyboard nav, ARIA roles), styled entirely with the tokens above.
`class-variance-authority` (`cva`) for variant props, so a component
like `Button` exposes `variant`/`size` instead of callers hand-picking
Tailwind classes.

Each component is added in the stage whose screens first use it. The
original spec front-loaded `Dialog` and `Toast` into Stage 1 with no
consumer, to avoid a second dependency install; that trade is dropped
— an unused primitive is designed against imagined usage, and Stage 3
now has real consumers for both.

### Stage 1 components

| Component | Replaces | Notes |
|---|---|---|
| `Button` | `<button className="rounded bg-slate-900 ...">` scattered per page | variants: `primary`/`secondary`/`ghost`/`danger`; `isLoading` prop shows a spinner and disables |
| `Badge` | ad-hoc `<span className="text-xs uppercase ...">`, and the receivables bucket pill | variants map to semantic colors: obligation urgency (`overdue`→danger, `thisWeek`→warning), ageing bucket, `writtenOff` |
| `Card` | `<div className="rounded border ...">` | flat, bordered, one padding scale |
| `EmptyState` | a lone `<p className="text-sm text-slate-600">` | icon + heading + optional description + optional CTA button |
| `Skeleton` | `if (isPending) return null` | pulsing placeholder blocks, sized per context (list row, card, summary tile) |
| `PageHeader` | each page's own `<header className="flex items-center justify-between">` | title + optional description + action slot (buttons/links) |
| `DropdownMenu` | none exists yet | Radix-backed; first consumer is the account/sign-out menu in the shell |
| `Money` | four different treatments of currency (see Problem) | wraps `formatCurrency` from `src/i18n/format`; tabular figures, right-aligned, `tone` derived from the amount's sign unless overridden |
| `DataList` | the ledger's flex rows, the receivables rows, the client detail `<dl>` grid | label/value rows with optional total footer; value slot takes any node, usually `Money` |

**`Money` in detail.** Props: `cents: number`, and an optional
`tone: 'auto' | 'credit' | 'debit' | 'writtenOff'` defaulting to
`auto`. `auto` reads the sign — negative is a credit (success color),
positive is a debit (default text color). `writtenOff` renders struck
through and muted regardless of sign. The explicit `tone` escape hatch
exists because sign and meaning come apart: an unconsumed client
credit (ADR 0007, deferred to Phase 4) is a positive balance the client
may spend, and when that lands it passes `tone="credit"` without any
change to this signature.

`Money` never formats currency itself — it delegates to the existing
`formatCurrency(cents, locale)` so there is exactly one place where
cents become a localized string.

**`DataList` in detail.** Renders a list of `{ label, value }` rows
with the label left and the value right, plus an optional `total` row
separated by a top border. Consumers pass nodes, not strings, so a
label can be a link (receivables' client name) and a value can be a
`Badge` plus a `Money` side by side. It is a layout component with no
knowledge of billing.

New dependencies in Stage 1: `@radix-ui/react-dropdown-menu`,
`class-variance-authority`, `lucide-react`, `@fontsource/inter`.

### Later-stage components

- **Stage 2**: `Input`, `Select`, `Checkbox` — the clients filter bar
  and the client form are the first places the system needs real form
  controls with label and error states. Adds
  `@radix-ui/react-select`, `@radix-ui/react-checkbox`.
- **Stage 3**: `Dialog` (the write-off reason prompt, the
  add-credential form), `Toast` (copy-to-clipboard confirmation).
  Adds `@radix-ui/react-dialog`, `@radix-ui/react-toast`.
- **Stages 4-5**: no new components.

## Screens — Stage 1

### App shell (`apps/web/src/shell/AppLayout.tsx`)

- Desktop (`md:` and up): fixed-width left sidebar (240px) — app name
  at top, nav items with `lucide-react` icons (Dashboard, Clients,
  Vault), account area pinned to the bottom (language switcher, vault
  lock button when unlocked, sign-out) collapsed into a `DropdownMenu`
  behind an avatar/initial button instead of three loose buttons in
  the header.
- Mobile (below `md:`): sidebar collapses to a bottom tab bar (icons
  only, active state via accent color) for the three primary
  destinations; the account menu moves into a header-right icon
  button.
- `ConnectionStatus` becomes a small `Badge`-style pill in the header
  (visible only when offline/syncing) instead of a full-width banner
  element always taking layout space.
- Main content area keeps a max-width constraint but increases from
  `max-w-5xl` to `max-w-6xl` to give the denser dashboard cards room.

### HomePage (`apps/web/src/HomePage.tsx`)

Today this file is a bare flex wrapper around two sections, and
`ObligationsDashboard` owns the page's only `<h1>`. It becomes a page
in its own right:

- A `PageHeader` carries the page title. `ObligationsDashboard` and
  `ReceivablesSection` both drop to `<h2>` beneath it, as peers.
- A summary row spanning both features sits directly under the header:
  one `Card` tile per urgency bucket that has items (`overdue`,
  `thisWeek`, `thisMonth`) showing a large count in its semantic
  color, plus one tile showing total outstanding as `Money`. The
  practice sees the shape of the week and the money owed in a single
  glance, which is the actual reason this screen is the landing page.
- Each section keeps its own loading state. The two queries are
  independent (`['obligations']` and `['receivables']`) and a slow
  receivables response must not hold the obligations list back. The
  summary row's outstanding tile shows its own `Skeleton` while
  receivables is pending.

### Obligations Dashboard (`apps/web/src/obligations/ObligationsDashboard.tsx`)

- Replaces `if (obligations.isPending) return null` with a `Skeleton`
  layout matching the loaded structure — no more blank-screen flash.
- Each urgency section heading gets a `Badge` matching the summary
  tile's color, replacing the plain `text-sm font-semibold text-slate-500`
  heading — visual continuity between the summary and the detail list.
- Empty state (`dashboard.empty`) becomes an `EmptyState` component
  (checkmark icon, the existing translated copy, no CTA — there is
  nothing to create from an empty obligations list, it populates from
  the catalog generator).
- `ObligationRow` itself is not restructured in this stage — it
  already renders inside the new `Card`/`Badge` context without
  changing its internal layout; only its container changes.

### Receivables (`apps/web/src/billing/ReceivablesSection.tsx`)

- Rows become `DataList` rows: client name as label, ageing `Badge`
  and `Money` as the value slot.
- The client name becomes a link to `/clients/$clientId`. Following a
  receivable to its client is the only thing an operator does from
  this list, and today the name is dead text.
- The bucket pill's `rounded bg-slate-100 px-2 py-0.5 text-xs` becomes
  a `Badge` whose variant maps the four `ageingBucket` literals
  (`'0-30'`, `'31-60'`, `'61-90'`, `'90+'`) onto a neutral→danger
  ramp. The API's literals are the variant keys; no renaming.
- `if (receivables.isPending) return null` becomes a `Skeleton` row
  list.
- Empty state becomes an `EmptyState` (coin icon, the existing
  `receivables.empty` copy, no CTA — receivables are generated, not
  created here).

## i18n and accessibility

- Two new keys: the `HomePage` title and the summary row's
  total-outstanding tile label. Both go in the `common` namespace with
  `pt-PT` and `en-GB` entries. Every other label in Stage 1 already
  has a key; new UI (the account dropdown's "Lock vault" / "Sign out"
  items) reuses the existing `common:actions.*` keys.
- `pnpm --filter @ledger-hq/web i18n:check` must stay green — no key
  added without both locales.
- Radix primitives provide correct ARIA roles and keyboard handling
  for the dropdown menu out of the box; manual testing covers: tab
  order through the sidebar, Escape closing the account menu, focus
  returning to the trigger on close.
- Color contrast: accent indigo-600 on white and white-on-indigo-600
  both meet WCAG AA for text; badge semantic colors use their `-700`
  text shade on a `-50` background tint, not raw saturated color as
  text.
- `Money` conveys credit and debit through color, so color is never
  its only signal: a credit keeps its minus sign (or the locale's
  parenthesized negative form, whichever `formatCurrency` produces),
  and a written-off amount is struck through as well as muted.

## Testing

- Existing tests for `AppLayout.test.tsx`, `ObligationsDashboard.test.tsx`,
  and `ReceivablesSection.test.tsx` are updated to query by role/text
  (already the pattern used) rather than by Tailwind class — they should
  need minimal changes since they don't assert on styling.
- New test: the responsive sidebar/bottom-bar switch is a CSS
  media-query concern, not asserted in JSDOM; covered instead by a
  Playwright e2e check at two viewport sizes (desktop, mobile)
  confirming the right nav affordance is present and clickable.
- `Skeleton` and `EmptyState` get their own unit tests (render without
  a query; confirm the right one shows for `isPending` vs. empty-array
  vs. error) since the existing dashboard tests didn't previously need
  to distinguish those states.
- `Money` gets unit tests for each `tone`: negative renders as a
  credit, positive as a debit, `writtenOff` struck through regardless
  of sign, and the formatted string matches `formatCurrency` for both
  locales.
- New file `HomePage.test.tsx` (none exists today — the page was a bare
  wrapper and had nothing to assert): the page renders its title, and
  renders the obligations list while receivables is still pending — the
  regression the independent-loading rule exists to prevent.

## Rollout plan

Named "Stage N" rather than "Phase N" to avoid colliding with the
product's own phase numbering (Phase 0 Foundation, Phase 1 Vault,
Phase 2 Obligations, Phase 3 Billing) — the UI refresh cuts across
those phases. Full detail, including why this order, in
[`docs/design/roadmap.md`](../../design/roadmap.md).

1. **This stage (branch `design/ui-refresh`)**: tokens, the
   `apps/web/src/ui/` component library, the app shell, and the whole
   `HomePage` — obligations dashboard and receivables together. One PR.
2. **Stage 2**: Clients list and create/edit form — introduces
   `Input`/`Select`/`Checkbox` against real forms.
3. **Stage 3**: `ClientDetailPage` and its five sections (fiscal
   profile, obligations, billing ledger, employments, vault
   credentials) — introduces `Dialog` and `Toast`.
4. **Stage 4**: Vault standalone screens (platforms, setup/recovery).
5. **Stage 5**: Auth (login, first-run setup) — last because it is the
   least-frequently-seen screen and blocks nothing.

Stages 2-5 each get their own brainstorming pass and their own spec.
This document commits to Stage 1's design in detail; the later stages
are named here to show the target shape of the component library, not
as approved designs.

## Known decisions deferred to later stages

- **The client detail page's layout** (Stage 3): six sections, five
  loading independently, is past what a single scroll carries well.
  Tabs, accordion, or a two-column split is the central question of
  that stage, not a footnote to it.
- **Client credit** (Phase 4, ADR 0007): when unallocated payment
  excess becomes consumable, the ledger gains a credit balance
  distinct from a negative balance. `Money`'s `tone` prop takes that
  third state without a signature change; nothing is implemented for
  it now.
- **The write-off flow** (Stage 3): the reason is required, and an
  inline text input inside a list row cannot communicate that. It
  becomes a `Dialog` when that stage lands.

## Guidelines document

`docs/design/guidelines.md`, written alongside the Stage 1
implementation: token reference table, "when to use which component"
decision notes (`Badge` vs `Card` vs plain text for status; `Money`
vs a raw formatted string), the accessibility checklist above turned
into a reusable checklist, and the i18n rule (no hardcoded strings,
`i18n:check` in CI gates it).
