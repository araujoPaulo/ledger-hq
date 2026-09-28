# Design guidelines

What Stage 1 actually shipped, written from the code rather than from the
spec. The design system lives at `apps/web/src/ui/`; its tokens live in
`apps/web/src/styles.css`. The screens these rules were derived from are on
the [canvas](https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92).

Extended by each later stage that adds a component or a pattern this does
not cover.

## 1. Tokens

Defined in one `@theme` block in `apps/web/src/styles.css`. There is no
`tailwind.config.js` and none is to be added — the project is on Tailwind
v4's CSS-first setup.

### Colour

| Token | Value | Use |
|---|---|---|
| `ground` | `#f7f8fa` | the page behind everything |
| `surface` | `#ffffff` | cards, rows, menus — anything that sits on the ground |
| `ink` | `#14181f` | body and heading text, and a debit amount |
| `muted` | `#5a6472` | labels, dates, secondary text (6.0:1 on surface) |
| `subtle` | `#8a93a2` | 3.1:1 — never body text; only ≥24px, or a struck-through amount |
| `line` | `#e2e5ea` | card borders, row separators |
| `line-strong` | `#cfd4dc` | a control's own border, a total's top rule |
| `accent-50` / `accent-600` / `accent-700` | `#eef2ff` / `#4f46e5` / `#4338ca` | active nav, primary button, links |
| `success-50` / `success-700` | `#f0fdf4` / `#15803d` | a credit, a settled charge |
| `warning-50` / `warning-700` | `#fffbeb` / `#b45309` | due this week, 31-60 days |
| `severe-50` / `severe-700` | `#fff4ed` / `#9a3412` | 61-90 days |
| `danger-50` / `danger-700` | `#fef2f2` / `#b91c1c` | overdue, 90+ days, destructive actions |

A semantic colour is always its `-700` text on its `-50` tint. Never
saturated colour as text, never a filled danger button.

**Ageing needs four steps** because `ageingBucket` has four literals;
`severe` is the fourth, between warning and danger. It is a token, not a
one-off.

### Type

Inter, self-hosted through `@fontsource/inter` (latin, weights 400/500/600).
Two weights in use: `font-medium` for anything that is not prose,
`font-semibold` for headings and emphasis. Weight 400 is for multi-line
prose only.

The scale is complete at: `text-2xl` page title, `text-lg`/`text-base`
section headings, `text-sm` rows and body, `text-xs` badges, captions and
dates. Nothing outside it.

Any column of numbers — amounts, dates, counts — is `tabular-nums`.
`Money` applies it for you.

### Spacing, radius, elevation

Three gaps: `gap-4` inside a control group, `gap-6` between elements in a
section, `gap-8` between sections. A layout that wants a fourth value
usually wants a different structure.

`rounded-surface` (8px) on cards and normal buttons; `rounded-control`
(6px) on small and icon-only buttons and on badges.

`shadow-overlay` is for things that float — the dropdown menu today,
dialogs and toasts from Stage 3. **Static cards are flat**: a border, no
shadow. This single rule is what keeps the interface from drifting into a
pile of floating boxes.

## 2. Which component for which job

**Status on a record** — a `Badge`. Urgency, ageing bucket, written-off.
Map the domain value to a tone in the feature's own folder
(`obligations/urgencyTone.ts`, `billing/ageingTone.ts`), never inside
`ui/`.

**Status about the app** — a `Badge` with `shape="pill"`. Only the
connection indicator, so far.

**A container** — a `Card`. `padding="none"` when its children own their
own padding, which is what a full-width row separator needs. Do not wrap
something that already draws its own surface: the obligation rows are each
their own bordered row, so they sit in a plain `<ul>`.

**Money, anywhere** — `Money`. Never call `formatCurrency` from a
component: `Money` is the only caller, so there is exactly one place where
cents become a localized string. `tone` defaults to reading the sign;
pass it explicitly when sign and meaning come apart (Phase 4's client
credit is a positive balance that is a credit).

**Label/value rows** — `DataList`, with `DataList.Total` for a footer.
Both slots take nodes, so a label can be a link and a value can be a badge
beside an amount.

**Nothing to show** — an `EmptyState`, never a bare grey sentence. Pass a
`description` when there is something worth saying about why the list is
empty; pass an `action` only when there is something the reader can create
from here.

**A pending query** — a `Skeleton` layout, never `return null`. Compose
the shape per screen, in a sibling file (`*Skeleton.tsx`): matching the
layout that replaces it is the screen's knowledge, not the library's.

**A page title** — exactly one `PageHeader` per page, which owns the page's
only `<h1>`. Sections below it start at `<h2>`.

## 3. Accessibility checklist

Run before opening a PR.

1. One `<h1>` per page, from `PageHeader`; headings descend with no level
   skipped.
2. Every icon-only control has an `aria-label`; every decorative icon is
   `aria-hidden="true"`.
3. Keyboard: tab order runs sidebar → content → account menu; the menu
   opens on Enter/Space, moves with arrows, closes on Escape, and returns
   focus to its trigger; every interactive element has a visible
   `focus-visible` ring.
4. Touch targets are at least 44px in the mobile nav and in any list row
   that holds a control.
5. Text contrast is at least 4.5:1, or 3:1 at 24px and above. `subtle` is
   therefore never body text.
6. Colour is never the only carrier of meaning: badges have text, `Money`
   keeps its sign, a written-off amount is struck as well as muted.
7. A loading region announces once (`aria-busy` on the region, every
   `Skeleton` `aria-hidden`), not once per placeholder.
8. `prefers-reduced-motion: reduce` disables the skeleton pulse — handled
   once in `styles.css`, not per component.
9. Real elements: `<button>` for actions, `<a>`/`Link` for navigation.
   Never `onClick` on a `div`.

## 4. i18n

No hardcoded user-visible string, and that includes every `aria-label`.
Every key exists in both `pt-PT` and `en-GB`;
`pnpm --filter @ledger-hq/web i18n:check` compares the two bundles and
runs in CI.

The check compares the bundles against **each other**, not against usage —
a key nothing references passes forever. Delete a key in the same commit
that removes its last reference.

Where two screens need the same word, reuse the key rather than adding a
second one: the sidebar's "Deadlines" item is
`obligations:dashboard.title`, the same key the dashboard heading uses.

Test files are exempt from `i18next/no-literal-string`
(`packages/config/eslint.config.mjs`): a component test has to render
literal children to have anything to assert on, and none of it ships.

## 5. The rule about `ui/`

Nothing in `apps/web/src/ui/` imports from a feature folder —
`obligations/`, `billing/`, `clients/`, `vault/`. It may import from
`i18n/` and from `lucide-react`.

Domain knowledge lives with its feature. `URGENCY_TONE` and `AGEING_TONE`
are the shape this takes: the feature maps its own vocabulary onto a
`BadgeTone`, and `Badge` never learns what an ageing bucket is.

A component sets no margin on itself. Spacing is the parent's job.
