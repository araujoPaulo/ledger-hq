# UI refresh, Stage 1 — design specification

**Date:** 2026-09-24
**Branch:** `design/ui-refresh`
**Status:** proposed
**Parent:** [UI refresh design](./2026-09-19-ui-refresh-design.md) ·
[roadmap](../../design/roadmap.md) ·
[screens](https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92)

The parent spec covers the whole refresh and names five stages. This
document is Stage 1 alone, in enough detail to plan and implement from:
the tokens, every component's API, every screen's target structure, the
i18n keys, and what the tests assert. Where it repeats the parent, the
parent is the summary and this is the contract.

## 1. Scope

Stage 1 establishes the design system and applies it to the two
surfaces every session begins with.

**Ships:**

- Design tokens in `apps/web/src/styles.css` via Tailwind v4's
  `@theme`.
- A component library at `apps/web/src/ui/`: `Button`, `Badge`,
  `Card`, `EmptyState`, `Skeleton`, `PageHeader`, `DropdownMenu`,
  `Money`, `DataList`.
- `apps/web/src/shell/AppLayout.tsx` rebuilt: desktop sidebar, mobile
  tab bar, account menu, connection pill.
- `apps/web/src/HomePage.tsx` becomes a real page: header, a summary
  row spanning both features, then the two sections.
- `apps/web/src/obligations/ObligationsDashboard.tsx` and
  `apps/web/src/billing/ReceivablesSection.tsx` restyled, with loading
  and empty states they do not have today.
- Five new i18n keys, in both locales.
- `docs/design/guidelines.md`, written from what actually shipped.

**Does not ship:**

- Any other screen. Clients, client detail, vault and auth keep their
  current styling until their stages.
- Dark mode. Tokens are shaped so it can be added later; no stage
  implements it.
- Form controls (`Input`, `Select`, `Checkbox`). Neither target screen
  has a form. They land in Stage 2, against real forms.
- `Tabs`, `Dialog`, `Toast`. No consumer until Stage 3.
- A `packages/ui` workspace package. One consumer does not need one.
- Any change to an API contract, a route, a query key or a business
  rule. Presentation only.

**Deliberately unchanged:** `ObligationRow`. It renders correctly
inside the new containers; restyling it is Stage 3's job, where the
per-client obligations section is in scope and the row's edit/waive
controls matter.

## 2. Visual reference

Four artboards on the canvas are Stage 1's target:

| Artboard | What it fixes |
|---|---|
| Overview — loaded | the whole page: shell, header, summary row, both sections |
| Overview — loading | what `Skeleton` looks like in each of its three contexts |
| Overview — empty & offline | both `EmptyState`s, and the connection pill in the header slot |
| Overview — mobile | the bottom tab bar, the header account button, row stacking |
| Tokens & components | every component with every variant, side by side |

The boards are the source of truth for spacing, colour and copy. Where
this document and a board disagree, raise it rather than guessing —
the board was drawn from this document's tokens, so a disagreement is a
mistake in one of them.

## 3. Dependencies

Added to `apps/web/package.json`:

| Package | Why | Notes |
|---|---|---|
| `@radix-ui/react-dropdown-menu` | the account menu | focus trap, roving tabindex, Escape, ARIA roles |
| `class-variance-authority` | variant props on `Button`/`Badge` | keeps Tailwind strings out of call sites |
| `lucide-react` | icons | tree-shakeable, MIT, no attribution |
| `@fontsource/inter` | self-hosted Inter | the app is reached over Tailscale; no CDN at runtime |

Not added: `clsx`/`tailwind-merge` (cva covers what Stage 1 needs; add
one only when a component must merge a caller's `className` against its
own conflicting utility), `@radix-ui/react-slot` (no link-styled-as-
button on these two screens; Stage 2's "Create" link is its first real
consumer).

**To verify at install time:** Radix's React 19 support. The app is on
React 19.2; `@radix-ui/react-dropdown-menu` must resolve to a version
whose peer range includes 19. If it does not, the account menu falls
back to a `<details>`/`<summary>` disclosure with manual Escape
handling, and the dependency is deferred to Stage 3 — this is a
five-minute check at the start of implementation, not a design
question.

`@fontsource/inter` imports only the weights and the latin subset in
use (400, 500, 600), to keep the PWA precache small. The Workbox
`globPatterns` in `vite.config.ts` already includes `woff2`, so the
faces are precached with no config change.

## 4. Tokens

`apps/web/src/styles.css` today is one line: `@import 'tailwindcss';`.
It becomes:

```css
@import 'tailwindcss';

@import '@fontsource/inter/latin-400.css';
@import '@fontsource/inter/latin-500.css';
@import '@fontsource/inter/latin-600.css';

@theme {
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;

  /* Surfaces and text */
  --color-ground: #f7f8fa;
  --color-surface: #ffffff;
  --color-ink: #14181f;
  --color-muted: #5a6472;
  --color-subtle: #8a93a2;
  --color-line: #e2e5ea;
  --color-line-strong: #cfd4dc;

  /* Accent */
  --color-accent-50: #eef2ff;
  --color-accent-600: #4f46e5;
  --color-accent-700: #4338ca;

  /* Semantic, least to most urgent */
  --color-success-50: #f0fdf4;
  --color-success-700: #15803d;
  --color-warning-50: #fffbeb;
  --color-warning-700: #b45309;
  --color-severe-50: #fff4ed;
  --color-severe-700: #9a3412;
  --color-danger-50: #fef2f2;
  --color-danger-700: #b91c1c;

  --radius-control: 0.375rem;
  --radius-surface: 0.5rem;

  --shadow-overlay: 0 10px 24px rgb(20 24 31 / 0.12);
}
```

Each `--color-*` entry generates the `bg-`, `text-`, `border-` and
`ring-` utilities for that name; `--radius-*` generates `rounded-*`;
`--shadow-*` generates `shadow-*`. No `tailwind.config.js` is
introduced — the project is on the CSS-first v4 setup and stays there.

**Rules the tokens encode.**

- **Two text weights.** `font-medium` (500) is the default for
  anything that is not body prose; `font-semibold` (600) is headings
  and emphasis. 400 exists for multi-line prose only (empty-state
  descriptions, the fiscal-profile notes).
- **Type scale.** `text-2xl` page title, `text-lg`/`text-base` section
  headings, `text-sm` rows and body, `text-xs` badges, captions and
  dates. Nothing outside that set.
- **Three gaps.** `gap-4` within a control group, `gap-6` between
  elements in a section, `gap-8` between sections. A layout wanting a
  fourth value is usually wanting a different structure.
- **Radius.** `rounded-surface` (8px) on cards, inputs and normal
  buttons; `rounded-control` (6px) on small and icon-only buttons and
  on badges.
- **Elevation.** `shadow-overlay` is for things that float: the
  dropdown menu now, dialogs and toasts in Stage 3. Static cards are
  flat with a `border-line`. This single rule is what keeps the
  interface from drifting into stacked drop-shadow cards.
- **Ageing needs four steps**, one more than success/warning/danger
  provide, because `ageingBucket` has four literals. `severe` is that
  fourth step, between warning and danger. It exists as a token, not
  as a one-off in the receivables row.
- **Tabular figures.** `font-variant-numeric: tabular-nums` is applied
  by `Money` and by any column of dates or counts, so amounts in a
  column align on the decimal point.

Colour contrast: every semantic pair is a `-700` text shade on a `-50`
tint, which clears WCAG AA for normal text. `--color-muted` on
`--color-surface` is 6.0:1; `--color-subtle` is 3.1:1 and is therefore
allowed only for text at 24px or larger, or for a struck-through
amount whose meaning is already carried by the strike.

## 5. File layout

```
apps/web/src/
  styles.css                     tokens (§4)
  ui/
    Badge.tsx                    Badge
    Button.tsx                   Button
    Card.tsx                     Card
    DataList.tsx                 DataList, DataList.Row, DataList.Total
    DropdownMenu.tsx             Radix re-exports, styled
    EmptyState.tsx               EmptyState
    Money.tsx                    Money
    PageHeader.tsx               PageHeader
    Skeleton.tsx                 Skeleton
    index.ts                     the public surface of the library
  shell/
    AppLayout.tsx                composition only
    Sidebar.tsx                  desktop nav (new)
    MobileNav.tsx                mobile header + bottom tab bar (new)
    AccountMenu.tsx              DropdownMenu: language, lock vault, sign out (new)
    ConnectionStatus.tsx         becomes a Badge pill
    LanguageSwitcher.tsx         deleted — absorbed into AccountMenu
  HomePage.tsx                   page shell, composition
  home/
    SummaryRow.tsx               the four tiles (new)
  obligations/
    ObligationsDashboard.tsx     restyled
    urgencyTone.ts               UrgencyGroup -> Badge tone (new)
  billing/
    ReceivablesSection.tsx       restyled
    ageingTone.ts                ageingBucket -> Badge tone (new)
```

Everything in `ui/` is domain-free: no imports from `obligations/`,
`billing/`, `clients/` or `vault/`, and no knowledge of what an
urgency group or an ageing bucket is. The two `*Tone.ts` mapping files
live with their feature, which is what keeps that boundary honest. A
component in `ui/` may import from `i18n/` (`Money` needs the active
locale) and from `lucide-react`.

`ui/index.ts` re-exports every component so call sites import from
`../ui` rather than reaching into individual files.

## 6. Components

Conventions for all of them: named exports, no default exports; props
extend the underlying element's props (`ComponentPropsWithoutRef<'x'>`)
so `aria-*`, `id` and event handlers pass through; `cva` for variants;
no component sets a margin on itself — spacing is the parent's job.

### 6.1 `Button`

```ts
type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'  // default 'secondary'
  size?: 'sm' | 'md' | 'icon'                             // default 'md'
  isLoading?: boolean
}
```

- `primary`: accent-600 fill, white text. `secondary`: surface fill,
  `line-strong` border. `ghost`: no fill, no border, muted text.
  `danger`: surface fill, danger-700 border and text — destructive
  actions are outlined, not filled, so a red wall never becomes the
  loudest thing on a screen.
- `isLoading` sets `disabled`, `aria-busy="true"` and renders a
  `Loader2` spinner before the children. The label stays visible: a
  button that swaps its text for a spinner loses its accessible name
  mid-action.
- `size="icon"` is a 34px square and **requires** `aria-label`; this
  is enforced by the type (`size: 'icon'` narrows props to require
  `'aria-label': string`).
- Focus: `focus-visible:ring-2 ring-accent-600 ring-offset-2`, never
  `outline-none` without a replacement.

**Replaces:** every `className="rounded bg-slate-900 px-3 py-2 …"` and
`className="rounded border border-slate-300 …"` in the two target
screens.

### 6.2 `Badge`

```ts
type BadgeProps = ComponentPropsWithoutRef<'span'> & {
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'severe' | 'danger'
  shape?: 'tag' | 'pill'   // default 'tag'
  strikethrough?: boolean
}
```

- `tag` is `rounded-control`; `pill` is `rounded-full` and is reserved
  for status that is about the app rather than about a record — in
  Stage 1, only the connection pill.
- Each tone is its `-700` text on its `-50` tint. `neutral` is
  `text-muted` on `bg-ground`.
- `strikethrough` exists for `Written off` in Stage 3; it is built now
  because it costs one line and the Components board already shows it.

Domain mapping lives outside the component:

```ts
// obligations/urgencyTone.ts
export const URGENCY_TONE: Record<UrgencyGroup, BadgeTone> = {
  overdue: 'danger', thisWeek: 'warning', thisMonth: 'neutral', later: 'neutral',
}

// billing/ageingTone.ts
export const AGEING_TONE: Record<AgeingBucket, BadgeTone> = {
  '0-30': 'neutral', '31-60': 'warning', '61-90': 'severe', '90+': 'danger',
}
```

`AgeingBucket` is currently an inline union in
`apps/web/src/billing/api.ts`; it is extracted to a named exported type
in that same file so the mapping can be typed against it. That is the
only change to a non-presentation file in this stage, and it adds no
runtime code.

### 6.3 `Card`

```ts
type CardProps = ComponentPropsWithoutRef<'div'> & {
  padding?: 'none' | 'sm' | 'md'   // default 'md'
}
```

Surface fill, `border-line`, `rounded-surface`, no shadow. `padding
="none"` exists for a card whose children own their own padding — the
receivables `DataList`, whose rows need full-width separators.

### 6.4 `EmptyState`

```ts
type EmptyStateProps = {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}
```

Centred column inside a `Card`: a 48px tinted circle holding the icon,
the title at `text-base font-semibold`, the description at `text-sm
text-muted` capped at ~50 characters per line, then the action. The
icon is decorative (`aria-hidden`); the title carries the meaning.

Neither Stage 1 consumer passes `action` — there is nothing to create
from an empty obligations list or an empty receivables list. The prop
exists because Stage 2's client list has an obvious one.

### 6.5 `Skeleton`

```ts
type SkeletonProps = ComponentPropsWithoutRef<'span'> & {
  width?: string     // any CSS length; default '100%'
  height?: string    // default '1rem'
}
```

A `bg-line` block with `rounded-control` and a 1.6s opacity pulse.
`aria-hidden="true"` on every instance: the loading state is announced
once by the region's own `aria-busy`, not by a dozen shimmering boxes.

The component is a single block. **Screen-shaped skeletons are
composed by the screen**, in a sibling file
(`ObligationsDashboardSkeleton.tsx`,
`ReceivablesSectionSkeleton.tsx`), because the point of a skeleton is
to match the layout that replaces it — that knowledge belongs to the
screen, not to `ui/`.

Respect `prefers-reduced-motion: reduce` by dropping the animation and
keeping the static block.

### 6.6 `PageHeader`

```ts
type PageHeaderProps = {
  title: string
  description?: string
  actions?: ReactNode
}
```

Renders `<h1>` plus an optional description and a right-aligned action
slot. On mobile the actions wrap below the title rather than squeezing
it.

Exactly one `PageHeader` per page, and it owns the page's only `<h1>`.
This is the rule that fixes today's heading order: `ObligationsDashboard`
currently renders an `<h1>`, so a page with two sections has two
competing first-level headings.

### 6.7 `DropdownMenu`

Thin styled re-exports of Radix: `DropdownMenu` (Root), `.Trigger`,
`.Content`, `.Item`, `.Label`, `.Separator`, `.RadioGroup`,
`.RadioItem`. Content gets `bg-surface border-line rounded-surface
shadow-overlay`, 6px padding, `sideOffset={6}`, and
`align="end"`. Items are `text-sm`, 34px tall, `rounded-control`, with
a `bg-ground` highlight on `data-[highlighted]`.

Radix supplies the behaviour the current header does not have: focus
moves into the menu on open, arrow keys move between items, Escape
closes and returns focus to the trigger, and the trigger carries
`aria-expanded`/`aria-haspopup`.

### 6.8 `Money`

```ts
type MoneyProps = ComponentPropsWithoutRef<'span'> & {
  cents: number
  tone?: 'auto' | 'credit' | 'debit' | 'writtenOff'   // default 'auto'
  size?: 'sm' | 'md' | 'lg'                           // default 'md'
}
```

- Formats through the existing `formatCurrency(cents, locale)` from
  `src/i18n/format.ts` — `Money` never builds a currency string
  itself, so there stays exactly one place where cents become text.
  The locale comes from `useTranslation()`'s `i18n.language`.
- `auto` reads the sign: negative renders as a credit
  (`text-success-700`), positive as a debit (`text-ink`).
- `writtenOff` renders `line-through text-subtle` regardless of sign.
- `credit` and `debit` force the tone. The escape hatch exists because
  sign and meaning come apart: Phase 4's unconsumed client credit
  (ADR 0007) is a *positive* balance the client may spend, and it
  will pass `tone="credit"` with no change to this signature.
- Always `tabular-nums`; `text-right` is the caller's choice, since
  `Money` also appears inline in a sentence.
- Colour is never the only signal: the credit keeps whatever negative
  form `formatCurrency` produces for the locale, and the written-off
  amount is struck as well as muted.

### 6.9 `DataList`

A compound component for label/value rows — the shape that the ledger,
the receivables list and the client detail facts all share.

```tsx
<DataList>
  <DataList.Row label={<Link …>{name}</Link>}
                value={<><Badge …/><Money cents={…} /></>} />
  <DataList.Total label={t('…')} value={<Money cents={total} />} />
</DataList>
```

- `Row`: label left, value right, `border-b border-line` except on the
  last row, 44px minimum height so a row with a control in it is a
  comfortable touch target.
- `Total`: same shape with a heavier top border, `font-semibold`, and
  no bottom border.
- Both slots take `ReactNode`, which is what lets a label be a link
  and a value be a badge beside an amount. `DataList` itself knows
  nothing about money.
- Renders as `<dl>`/`<div><dt><dd>` when every label is plain text,
  and as plain `<div>`s when a label is interactive — a `<dt>`
  containing a link is legal but reads oddly to a screen reader in a
  list that is really a set of navigation targets. **Decision:** keep
  it simple and always render `<div>`s with the semantics carried by
  the surrounding `<section>` and its heading. Revisit in Stage 3,
  where the client detail facts are a genuine description list.

## 7. Screens

### 7.1 App shell — `shell/AppLayout.tsx`

Today: a single top header with the app name, two text links, a
`<select>` language switcher and two loose buttons; a full-width
amber offline banner below it; `max-w-5xl` content.

Target:

- **Desktop (`md:` and up)** — a 240px fixed sidebar (`Sidebar.tsx`):
  the app name with its mark at the top; three nav items with icons;
  the account button pinned to the bottom. Content fills the rest,
  `max-w-6xl` centred, `px-6 py-8`.
- **Mobile (below `md:`)** — a 56px top bar carrying the page title
  area and the account button, and a fixed bottom tab bar
  (`MobileNav.tsx`) with the three destinations as icons only, active
  in accent. Each tab is a 52px touch target and carries an
  `aria-label`, since it has no visible text.
- **Nav items:** Deadlines (`/`), Clients (`/clients`), Vault
  (`/vault/platforms`). Icons: `CalendarCheck`, `Users`, `Vault` from
  lucide. The active item is set from the router's current match and
  carries `aria-current="page"`.
- **The third item is renamed.** It is labelled "Platforms" today,
  which names an implementation detail on the one screen a user
  reaches the credential vault through. New key `common:nav.vault`;
  the route `/vault/platforms` and the `PlatformsPage` component keep
  their names, because renaming a route buys nothing and breaks
  bookmarks.
- **`AccountMenu.tsx`** replaces the three loose header controls: a
  trigger showing the user's initials, and a menu holding the
  language choice (a `RadioGroup` over `SUPPORTED_LOCALES`, replacing
  the `<select>`), a separator, "Lock vault" (only when
  `vaultState.status === 'unlocked'`), and "Sign out" in the danger
  tone. `LanguageSwitcher.tsx` is deleted; its behaviour —
  `setLocale(locale)` — moves into the menu items unchanged.
- **`ConnectionStatus.tsx`** keeps its logic exactly (it still returns
  `null` when online, and still computes `lastUpdated` from the query
  cache) and changes only what it renders: a `Badge shape="pill"
  tone="danger"` with a `WifiOff` icon in the header's right slot,
  holding the existing `connection.offline` string, with the existing
  `connection.lastSync` line inside the same `role="status"` element
  as visually-hidden text. No new key, nothing lost to a tooltip, and
  the banner stops consuming a full row of layout on every offline
  render.

`AppLayout` itself ends up as composition: the two nav components, the
account menu, `RequireSession` and `<Outlet />`. `useVaultSync()` and
the sign-out mutation move into `AccountMenu`, which is the only thing
that uses them.

### 7.2 `HomePage.tsx`

Today: a bare flex wrapper around two sections, with no header of its
own.

Target:

```tsx
<div className="flex flex-col gap-8">
  <PageHeader title={t('common:home.title')} description={longDate} />
  <SummaryRow />
  <ObligationsDashboard />
  <ReceivablesSection />
</div>
```

- The description is today's date through the existing
  `formatLongDate(todayIso, locale)`. It costs no key and it tells the
  reader what "this week" is anchored to.
- `SummaryRow` (`home/SummaryRow.tsx`) renders a tile per urgency
  bucket **that has items** — so an empty bucket is absent, not a
  zero — plus one tile for total outstanding, as `Money`.
- **`SummaryRow` runs its own two queries**, with the same keys the
  sections use (`['obligations']`, `['receivables']`). React Query
  dedupes them into the same two network requests, so this costs
  nothing and keeps the row from forcing `HomePage` to become a data
  component that prop-drills into both sections. Each tile shows its
  own `Skeleton` while its query is pending, so a slow receivables
  response does not blank the urgency counts.
- Counts come from `groupByUrgency(data, new Date())` — the same pure
  function the dashboard uses, called on the same data from the same
  cache entry, so the row and the list can never disagree.
- Total outstanding is `sum(receivables.map(r => r.outstandingCents))`,
  computed client-side; there is no API for it and this stage adds no
  endpoint.

### 7.3 `obligations/ObligationsDashboard.tsx`

- `if (obligations.isPending) return null` becomes
  `<ObligationsDashboardSkeleton />` — a group heading block and three
  row blocks, matching the loaded layout.
- Its `<h1>` becomes an `<h2>`; `HomePage`'s `PageHeader` now owns the
  page's `<h1>`.
- Each urgency section heading becomes a `Badge` with
  `URGENCY_TONE[key]` and the group's count — the same tone as that
  bucket's summary tile, which is what ties the row to the list.
- The empty state becomes `<EmptyState icon={CircleCheck}
  title={t('dashboard.empty')} description={t('dashboard.emptyHint')} />`
  inside a `Card`.
- Rows keep `ObligationRow` untouched, inside a `Card padding="none"`.
- `markDone`'s error still renders through `ErrorMessage`, unchanged.

### 7.4 `billing/ReceivablesSection.tsx`

- `if (receivables.isPending) return null` becomes
  `<ReceivablesSectionSkeleton />`.
- The list becomes a `Card padding="none"` holding a `DataList`: the
  label is a `Link` to `/clients/$clientId`, the value is the ageing
  `Badge` plus `<Money cents={row.outstandingCents} />`.
  **The client name becomes a link** — following a receivable to its
  client is the only thing anyone does from this list, and today the
  name is dead text.
- The bucket pill's hand-rolled classes become
  `<Badge tone={AGEING_TONE[row.ageingBucket]}>{t(\`receivables.bucket.${row.ageingBucket}\`)}</Badge>`.
  The API's literals stay the keys; nothing is renamed.
- A `DataList.Total` closes the list with the same figure the summary
  tile shows. The repetition is deliberate: the tile is a summary of
  the page, the total is the foot of a ledger, and a list of amounts
  that does not add up on screen invites someone to add it up by hand.
- Empty becomes `<EmptyState icon={Coins} title={t('receivables.empty')}
  description={t('receivables.emptyHint')} />`.

## 8. i18n

Five new keys. Every one gets both locales, or
`pnpm --filter @ledger-hq/web i18n:check` fails, which CI runs.

| Key | `pt-PT` | `en-GB` |
|---|---|---|
| `common:home.title` | Resumo | Overview |
| `common:home.outstanding` | Em dívida | Outstanding |
| `common:nav.vault` | Cofre | Vault |
| `obligations:dashboard.emptyHint` | As obrigações aparecem aqui à medida que o gerador do catálogo as cria para cada cliente. | Obligations appear here as the catalog generator creates them for each client. |
| `billing:receivables.emptyHint` | Está tudo liquidado. Os encargos aparecem aqui quando se vencem. | Every client is settled. Charges appear here once they fall due. |

`common:nav.platforms` is removed once nothing references it — the
check script compares the two bundles against each other, not against
usage, so a stale key would pass silently. Removing it in the same
commit as the rename is the only thing that keeps the bundles honest.

Every other label on these screens already has a key. The account
menu's items reuse `common:actions.lockVault`, `common:actions.signOut`
and `common:language.*`. The nav reuses `common:nav.clients`. No
string is hardcoded, including the ones only a screen reader hears
(`aria-label` on the mobile tabs uses the same `common:nav.*` keys).

## 9. Accessibility

Checked before the PR is opened, and carried into
`docs/design/guidelines.md` as a reusable list:

1. One `<h1>` per page, from `PageHeader`; section headings descend in
   order with no level skipped.
2. Every icon-only control has an `aria-label`; every decorative icon
   is `aria-hidden="true"`.
3. Keyboard: tab order runs sidebar → content → account menu; the
   account menu opens on Enter/Space, moves with arrows, closes on
   Escape and returns focus to its trigger; every interactive element
   has a visible `focus-visible` ring.
4. Touch targets are at least 44px in the mobile nav and on any
   control in a list row.
5. Text contrast is at least 4.5:1 (3:1 at 24px and above).
   `--color-subtle` is therefore never body text.
6. Colour is never the only carrier of meaning: urgency badges have
   text, `Money` keeps its sign, written-off amounts are struck.
7. Loading regions announce once (`aria-busy` on the region, skeletons
   `aria-hidden`), not per placeholder.
8. `prefers-reduced-motion: reduce` disables the skeleton pulse.
9. Real elements: `<button>` for actions, `<a>`/`Link` for
   navigation. No `onClick` on a `div`.

## 10. Testing

Existing tests query by role and text, not by class, so the restyling
should barely touch them. Where a test does change, it is because the
markup's *semantics* changed — a select becoming a menu — not its
styling.

**Updated:**

- `shell/AppLayout.test.tsx` — the sign-out and lock-vault buttons now
  live behind the account menu, so both cases open the menu first. The
  assertions themselves (that `signOut` is called, that the login
  heading returns, that lock-vault appears only when unlocked) are
  unchanged.
- `shell/ConnectionStatus.test.tsx` — same strings, now inside a pill;
  it already queries by `role="status"` and text.
- `obligations/ObligationsDashboard.test.tsx` — add the pending case,
  which previously rendered nothing to assert on.
- `billing/ReceivablesSection.test.tsx` — the client name is now a
  link; assert `getByRole('link', { name })` and its `href`.

**New:**

- `ui/Money.test.tsx` — each tone: negative renders as a credit,
  positive as a debit, `writtenOff` struck regardless of sign, and the
  text equals `formatCurrency` for both `pt-PT` and `en-GB`.
- `ui/EmptyState.test.tsx` — renders title and description, the icon
  is `aria-hidden`, the action renders only when passed.
- `ui/Skeleton.test.tsx` — is `aria-hidden`.
- `ui/DataList.test.tsx` — rows render both slots; `Total` renders
  last and is distinguishable from a row.
- `ui/Button.test.tsx` — `isLoading` disables, sets `aria-busy`, and
  keeps the accessible name.
- `shell/AccountMenu.test.tsx` — opening the menu, Escape closing it
  and returning focus to the trigger, and switching locale through the
  radio items calling `setLocale`.
- `HomePage.test.tsx` (the file does not exist today — the page was a
  bare wrapper with nothing to assert) — the page renders its title;
  and, the regression the independent-loading rule exists to prevent,
  the obligations list renders while the receivables query is still
  pending.

**End-to-end** (`e2e/shell.spec.ts`, new): at 1280×800 the sidebar is
visible and the bottom tab bar is not; at 390×844 the reverse; in both
cases the three destinations are reachable and land on the right
route. The responsive switch is a media query, which JSDOM does not
evaluate, so it can only be asserted in a real browser.

**Definition of done:** `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm --filter @ledger-hq/web i18n:check` and `pnpm --filter
@ledger-hq/web test:e2e` all green, and the four Stage 1 artboards
match what the browser renders at those two viewport sizes.

## 11. Risks

- **Radix and React 19** — checked at install (§3); the fallback is a
  `<details>` disclosure and deferring the dependency.
- **Scope creep into Stage 2.** The temptation, once `Button` and
  `Card` exist, is to "quickly" restyle the client list. It is not in
  this PR. The client list keeps its current styling and looks
  unrefreshed next to the new shell for one stage; that is the cost of
  a reviewable PR.
- **The summary row's double query.** If React Query's dedupe is ever
  defeated (different `queryKey` shapes, a `select` that breaks
  referential equality), the row silently doubles two requests. The
  `HomePage` test that renders the dashboard while receivables is
  pending is what catches it.
- **`@fontsource/inter` and the PWA precache.** Three weights of the
  latin subset is roughly 100KB. If the precache budget is tight, drop
  weight 400 and let the browser synthesise it for the two prose
  lines that use it.

## 12. Guidelines document

`docs/design/guidelines.md`, written at the end of the stage from what
actually shipped rather than from this document: the token table, a
"which component for which job" section (`Badge` vs `Card` vs plain
text for status; `Money` vs a raw formatted string), §9 turned into a
checklist, and the i18n rule with the command that enforces it.
