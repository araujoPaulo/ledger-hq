# UI refresh — design specification

**Date:** 2026-09-19
**Branch:** `design/ui-refresh`
**Status:** proposed

## Problem

The web app (`apps/web`) works but has no visual design: raw Tailwind
utility classes copy-pasted per page, no shared component library, no
design tokens beyond Tailwind's defaults, no loading states (queries
in the `pending` state render `null` — a blank screen), and empty
states are a single line of grey text. There is no dark mode, no
consistent spacing rhythm, and no icon usage anywhere. The result is
functional but reads as a prototype, not a product a practice would
want to open every day.

## Goals

- Establish a small, reusable design system (tokens + components) that
  every future screen builds from, instead of each page inventing its
  own Tailwind combination.
- Apply it first to the two highest-traffic surfaces — the app shell
  (navigation, header) and the Obligations Dashboard (the landing
  screen after login) — to prove the system and deliver visible value
  quickly.
- Leave every other screen (auth, clients, vault) on the current
  styling for now; they get their own stages later, each with its own
  plan.

## Non-goals

- Dark mode. Tokens are structured so it can be added later without
  rework, but it is not implemented in this stage.
- A new shared `packages/ui` workspace package. Only `apps/web`
  consumes the design system; a separate package would be an
  abstraction with a single consumer. The component library lives at
  `apps/web/src/ui/`.
- Redesigning clients, vault, or auth screens. Out of scope for this
  spec; tracked as later stages.
- Changing any backend/API contract, routing structure, or business
  logic. This is a presentation-layer change only.

## Design tokens

Defined via Tailwind v4's CSS-first `@theme` block in
`apps/web/src/styles.css` (no `tailwind.config.js` — the project
already uses the CSS-first v4 setup).

- **Color**: a neutral gray-blue scale (replaces ad-hoc `slate-*`
  usage) plus one accent scale, indigo, `50`→`900`. Semantic aliases
  on top: `success` (green), `warning` (amber), `danger` (red) — used
  for obligation urgency and form validation, not as raw Tailwind
  color classes sprinkled through components.
- **Typography**: Inter, self-hosted via `@fontsource/inter` (the app
  is self-hosted and reached over Tailscale; no dependency on a
  Google Fonts CDN at runtime). Scale: `text-xs` through `text-2xl`.
  Two weights only: `medium` (default) and `semibold` (headings/emphasis).
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

New dependencies: `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`,
`@radix-ui/react-select`, `@radix-ui/react-checkbox`, `@radix-ui/react-toast`,
`class-variance-authority`, `lucide-react`, `@fontsource/inter`.

Components built in this stage (only what the shell and dashboard need):

| Component | Replaces | Notes |
|---|---|---|
| `Button` | `<button className="rounded bg-slate-900 ...">` scattered per page | variants: `primary`/`secondary`/`ghost`/`danger`; `isLoading` prop shows a spinner and disables |
| `Badge` | ad-hoc `<span className="text-xs uppercase ...">` | variants map to urgency/semantic colors (`overdue`→danger, `thisWeek`→warning, etc.) |
| `Card` | `<div className="rounded border ...">` | flat, bordered, one padding scale |
| `EmptyState` | a lone `<p className="text-sm text-slate-600">` | icon + heading + optional description + optional CTA button |
| `Skeleton` | `if (isPending) return null` | pulsing placeholder blocks, sized per context (list row, card, summary tile) |
| `PageHeader` | each page's own `<header className="flex items-center justify-between">` | title + optional description + action slot (buttons/links) |
| `DropdownMenu` | none exists yet | Radix-backed; first consumer is the account/sign-out menu in the shell |

`Dialog` and `Toast` are added as primitives now (used by later stages)
but have no consumer in this stage's two screens — including them here
avoids a second dependency-install round when Clients/Vault redesign
lands.

Components not touched this stage: `Input`, `Select`, `Checkbox` — the
two target screens (shell, dashboard) don't have forms. They're built
in the stage that redesigns the first screen that needs them (Clients,
most likely), so the component and its first real usage land together.

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

### Obligations Dashboard (`apps/web/src/obligations/ObligationsDashboard.tsx`)

- Replaces `if (obligations.isPending) return null` with a `Skeleton`
  layout matching the loaded structure (summary tiles + list rows) —
  no more blank-screen flash.
- Adds a summary row above the grouped list: one `Card` per urgency
  bucket that has items (`overdue`, `thisWeek`, `thisMonth`) showing a
  large count and the semantic color, so the practice sees the shape
  of the week before reading the list.
- Each urgency section heading gets a `Badge` matching the summary
  tile's color, replacing the plain `text-sm font-semibold text-slate-500`
  heading — visual continuity between the summary and the detail list.
- Empty state (`dashboard.empty`) becomes an `EmptyState` component
  (checkmark icon, the existing translated copy, no CTA — there's
  nothing to create from an empty obligations list, it populates from
  the catalog generator).
- `ObligationRow` itself is not restructured in this stage — it
  already renders inside the new `Card`/`Badge` context without
  changing its internal layout; only its container changes.

## i18n and accessibility

- No new hardcoded strings. Every label already has a translation key
  (`common`, `obligations` namespaces); new UI (e.g. the account
  dropdown's "Lock vault" / "Sign out" items) reuses the existing
  `common:actions.*` keys already used by the current buttons.
- `pnpm --filter @ledger-hq/web i18n:check` must stay green — no key
  added without both `pt-PT` and `en-GB` entries.
- Radix primitives provide correct ARIA roles and keyboard handling
  for the dropdown menu out of the box; manual testing covers: tab
  order through the sidebar, Escape closing the account menu, focus
  returning to the trigger on close.
- Color contrast: accent indigo-600 on white and white-on-indigo-600
  both meet WCAG AA for text; badge semantic colors use their `-700`
  text shade on a `-50` background tint, not raw saturated color as
  text.

## Testing

- Existing tests for `AppLayout.test.tsx` and
  `ObligationsDashboard.test.tsx` are updated to query by role/text
  (already the pattern used) rather than by Tailwind class — they
  should need minimal changes since they don't assert on styling.
- New test: sidebar/bottom-bar responsive switch is a CSS media-query
  concern, not asserted in JSDOM tests; covered instead by a Playwright
  e2e check at two viewport sizes (desktop, mobile) confirming the
  right nav affordance is present and clickable.
- `Skeleton` and `EmptyState` get their own small unit tests (render
  without a query, confirm the right one shows for `isPending` vs.
  empty-array vs. error) since `ObligationsDashboard`'s existing tests
  didn't previously need to distinguish those states.

## Rollout plan

Named "Stage N" rather than "Phase N" to avoid colliding with the
product's own phase numbering (Phase 0 Foundation, Phase 1 Vault,
Phase 2 Obligations, Phase 3 Billing) — the UI refresh cuts across
those phases. Full detail, including why this order, in
[`docs/design/roadmap.md`](../../design/roadmap.md).

1. **This stage (branch `design/ui-refresh`)**: tokens, `apps/web/src/ui/`
   component library, App shell, Obligations Dashboard. One PR.
2. **Stage 2**: Clients (list, detail, form, fiscal profile form) —
   introduces `Input`/`Select`/`Checkbox` to the component library
   against real forms.
3. **Stage 3**: Vault (platforms, credentials, unlock gate, setup) —
   introduces `Dialog` (credential detail/add) and `Toast`
   (copy-to-clipboard confirmation).
4. **Stage 4**: Auth (login, setup, recovery) — last because it's the
   least-frequently-seen screen (logged into once per session) and has
   no dependency on new primitives beyond what stages 1-3 already add.

Each later stage gets its own brainstorming pass and its own spec —
this document only commits to Stage 1's design in detail; stages 2-4
are named here to show the target shape of the component library, not
as approved designs.

## Guidelines document

`docs/design/guidelines.md`, written alongside the Stage 1
implementation: token reference table, "when to use which component"
decision notes (e.g. `Badge` vs `Card` vs plain text for status),
accessibility checklist above turned into a reusable checklist, and
the i18n rule (no hardcoded strings, `i18n:check` in CI gates it).
