# UI refresh, Stage 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `apps/web` a design system — tokens plus a nine-component library — and apply it to the app shell and the whole Overview page, so the first screen of every session stops reading as a prototype.

**Architecture:** Tokens land in `apps/web/src/styles.css` through Tailwind v4's `@theme` block; there is no `tailwind.config.js` and none is introduced. Components live in `apps/web/src/ui/`, are domain-free (no import from `obligations/`, `billing/`, `clients/`, `vault/`), and expose variants through `class-variance-authority` so call sites never hand-pick Tailwind classes. Radix supplies keyboard and ARIA behaviour for the one menu. Screens are restyled in place: the shell is decomposed into `Sidebar`, `MobileNav` and `AccountMenu`; `HomePage` grows a header and a summary row; the two sections gain the loading and empty states they never had.

**Tech Stack:** React 19.2, TypeScript, Tailwind CSS v4 (CSS-first), TanStack Router and Query, i18next, Radix UI, `class-variance-authority`, `lucide-react`, `@fontsource/inter`, Vitest + Testing Library (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-ui-refresh-stage-1-design.md` — read it before Task 1; it carries the component APIs and the reasoning this plan executes. Its parent, `docs/superpowers/specs/2026-09-19-ui-refresh-design.md`, has the stage map. The screens are at <https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92>.

## Global Constraints

- **Presentation only.** No change to an API contract, a route path, a React Query `queryKey`, or a business rule. If a task seems to need one, stop and raise it.
- **No hardcoded user-visible strings.** Every label, including every `aria-label`, comes from a translation key. `pnpm --filter @ledger-hq/web i18n:check` runs in CI (`.github/workflows`, line 21) and compares the `pt` and `en` bundles against each other — it cannot catch a hardcoded string, only a missing translation, so this one is on the implementer.
- **Tests assert Portuguese.** Every existing web test calls `await i18next.changeLanguage('pt-PT')` after `initI18n()`, because jsdom reports `en-US` regardless of host. Follow that; assert `pt-PT` copy.
- **Named exports only**, no default exports, matching every existing file in `apps/web/src`.
- **Components never set their own margin.** Spacing belongs to the parent. A component that needs space around it is being composed wrong.
- **Two font weights:** `font-medium` (500) for anything that is not prose, `font-semibold` (600) for headings and emphasis. Weight 400 only for multi-line prose.
- **Type scale, complete:** `text-2xl` page title, `text-lg`/`text-base` section headings, `text-sm` rows and body, `text-xs` badges, captions and dates. Nothing outside that set.
- **Three gaps:** `gap-4` within a control group, `gap-6` between elements in a section, `gap-8` between sections.
- **Elevation:** `shadow-overlay` only on things that float (the dropdown menu). Static cards are flat with `border-line`.
- `tsconfig` has `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (see `packages/config`). Indexing a record gives `T | undefined`; assigning `undefined` into an optional prop fails to typecheck — use a conditional spread, the pattern `obligations.controller.ts` already uses.
- **Commit after every task**, with a `feat(web):`, `refactor(web):` or `chore(web):` prefix, matching the existing log.

## Review Focus

Five things the spec implies, that no task's happy-path test would catch, ordered by how likely they are to bite. Each has a test pinned to the task that owns the code.

1. **Both queries fail at once.** `HomePage` must render its header and both sections' error messages, and `SummaryRow` must render nothing rather than four zero tiles — a dashboard that says "0 overdue" when it simply could not load is worse than one that says nothing. → Task 15.
2. **`Money` with zero and with a negative zero.** `formatCurrency(0)` is `€0,00` and must render in the debit tone; `-0` must not produce `-€0,00`. → Task 7.
3. **Switching locale at runtime.** Amounts and dates are formatted inside components that must re-render on `changeLanguage`. A component that reads `i18n.language` without subscribing through `useTranslation()` silently keeps the old locale. → Task 7.
4. **A long client name in a receivables row.** The name must truncate rather than push the badge and the amount out of the row. → Task 14.
5. **Offline before anything has loaded.** `ConnectionStatus` computes `lastUpdated` from the query cache; with an empty cache it is `0` and the "last synchronised" fragment must be absent, not rendered with an epoch date. This behaviour exists today and must survive the rewrite. → Task 12.

---

### Task 1: Dependencies and design tokens

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: nothing.
- Produces (every later task): the Tailwind utilities `bg-ground`, `bg-surface`, `text-ink`, `text-muted`, `text-subtle`, `border-line`, `border-line-strong`, `bg-accent-50`, `bg-accent-600`, `text-accent-700`, the four `{success,warning,severe,danger}-{50,700}` pairs, `rounded-control`, `rounded-surface`, `shadow-overlay`, and Inter as the default sans face.

There is no meaningful unit test for a CSS token block — the first real assertion arrives in Task 2, whose `Button` renders these classes. The verification here is that the app builds and boots.

- [ ] **Step 1: Check Radix supports React 19 before installing it**

```bash
cd /Users/pauloaraujo/Projects/personal/ledger-hq
pnpm view @radix-ui/react-dropdown-menu peerDependencies
```

Expected: the `react` range includes `19` (e.g. `^16.8 || ^17.0 || ^18.0 || ^19.0`).

If it does **not**, stop and report it. The spec's fallback (§3) is a `<details>`/`<summary>` disclosure with manual Escape handling, and that changes Tasks 9 and 10 — it is a decision for the human partner, not something to work around silently.

- [ ] **Step 2: Install the dependencies**

```bash
pnpm --filter @ledger-hq/web add @radix-ui/react-dropdown-menu class-variance-authority lucide-react @fontsource/inter
```

- [ ] **Step 3: Write the tokens**

Replace the whole of `apps/web/src/styles.css` (today it is one line, `@import 'tailwindcss';`) with:

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

@media (prefers-reduced-motion: reduce) {
  .animate-pulse {
    animation: none;
  }
}
```

The reduced-motion block is here rather than in `Skeleton` because it is a page-wide policy, and Tailwind's `animate-pulse` is the only animation in the app.

- [ ] **Step 4: Verify the app still builds and the font resolves**

```bash
pnpm --filter @ledger-hq/web build
```

Expected: PASS. Then check the font files were bundled:

```bash
ls apps/web/dist/assets | grep -i inter | head
```

Expected: at least three `.woff2` files. If this is empty, the `@fontsource` import path is wrong for the installed version — run `ls apps/web/node_modules/@fontsource/inter/` and use the actual latin CSS filenames.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/src/styles.css pnpm-lock.yaml
git commit -m "feat(web): add the design tokens and their dependencies"
```

---

### Task 2: The five new translation keys

**Files:**
- Modify: `apps/web/src/i18n/locales/pt/common.json`
- Modify: `apps/web/src/i18n/locales/en/common.json`
- Modify: `apps/web/src/i18n/locales/pt/obligations.json`
- Modify: `apps/web/src/i18n/locales/en/obligations.json`
- Modify: `apps/web/src/i18n/locales/pt/billing.json`
- Modify: `apps/web/src/i18n/locales/en/billing.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `common:home.title`, `common:home.outstanding`, `common:nav.vault` (Tasks 10, 11, 15); `obligations:dashboard.emptyHint` (Task 13); `billing:receivables.emptyHint` (Task 14).

`common:nav.platforms` is **not** removed here — `AppLayout` still references it until Task 11. Removing it now would leave the app referencing a missing key for nine tasks.

- [ ] **Step 1: Add the keys to both `common.json` files**

In `pt/common.json`, add a `home` object after `appName` and a `vault` entry inside the existing `nav`:

```json
  "appName": "Ledger HQ",
  "home": { "title": "Resumo", "outstanding": "Em dívida" },
  "nav": { "clients": "Clientes", "platforms": "Plataformas", "vault": "Cofre" },
```

In `en/common.json`, the same shape:

```json
  "appName": "Ledger HQ",
  "home": { "title": "Overview", "outstanding": "Outstanding" },
  "nav": { "clients": "Clients", "platforms": "Platforms", "vault": "Vault" },
```

- [ ] **Step 2: Add the two empty-state hints**

In `pt/obligations.json`, inside `dashboard`:

```json
    "empty": "Sem obrigações pendentes.",
    "emptyHint": "As obrigações aparecem aqui à medida que o gerador do catálogo as cria para cada cliente."
```

In `en/obligations.json`, inside `dashboard`:

```json
    "empty": "No pending obligations.",
    "emptyHint": "Obligations appear here as the catalog generator creates them for each client."
```

In `pt/billing.json`, inside `receivables`:

```json
    "empty": "Sem valores em atraso.",
    "emptyHint": "Está tudo liquidado. Os encargos aparecem aqui quando se vencem."
```

In `en/billing.json`, inside `receivables`:

```json
    "empty": "No outstanding balances.",
    "emptyHint": "Every client is settled. Charges appear here once they fall due."
```

- [ ] **Step 3: Verify the bundles agree**

```bash
pnpm --filter @ledger-hq/web i18n:check
```

Expected: PASS, with a key count five higher than before.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/i18n/locales
git commit -m "feat(web): add the Stage 1 translation keys"
```

---

### Task 3: `Button`

**Files:**
- Create: `apps/web/src/ui/Button.tsx`
- Create: `apps/web/src/ui/Button.test.tsx`
- Create: `apps/web/src/ui/index.ts`

**Interfaces:**
- Consumes: Task 1's tokens.
- Produces: `Button`, and the barrel `apps/web/src/ui/index.ts` that every later UI task appends to.

- [ ] **Step 1: Write the failing test**

`apps/web/src/ui/Button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('renders its label and is enabled by default', () => {
    render(<Button>Guardar</Button>)
    const button = screen.getByRole('button', { name: 'Guardar' })
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('type', 'button')
  })

  // A button that swaps its label for a spinner loses its accessible name
  // mid-action, which is exactly when a screen reader user needs it.
  it('keeps its accessible name while loading, and disables itself', () => {
    render(<Button isLoading>Guardar</Button>)
    const button = screen.getByRole('button', { name: 'Guardar' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('passes through arbitrary button props', () => {
    render(<Button type="submit" data-testid="submit">Criar</Button>)
    expect(screen.getByTestId('submit')).toHaveAttribute('type', 'submit')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @ledger-hq/web test -- Button
```

Expected: FAIL — `Failed to resolve import "./Button"`.

- [ ] **Step 3: Implement**

`apps/web/src/ui/Button.tsx`:

```tsx
import type { ComponentPropsWithoutRef } from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'

const button = cva(
  'inline-flex items-center justify-center gap-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2 disabled:opacity-60 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        // Destructive actions are outlined, not filled: a red wall should
        // never be the loudest thing on a screen.
        primary: 'bg-accent-600 text-white border border-accent-600 hover:bg-accent-700',
        secondary: 'bg-surface text-ink border border-line-strong hover:bg-ground',
        ghost: 'bg-transparent text-muted border border-transparent hover:bg-ground',
        danger: 'bg-surface text-danger-700 border border-danger-700 hover:bg-danger-50',
      },
      size: {
        sm: 'rounded-control px-3 py-1.5 text-xs',
        md: 'rounded-surface px-4 py-2 text-sm',
        icon: 'rounded-control h-[34px] w-[34px] p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

type ButtonVariants = VariantProps<typeof button>

type ButtonProps = ComponentPropsWithoutRef<'button'> &
  ButtonVariants & {
    isLoading?: boolean
  }

export function Button({
  variant,
  size,
  isLoading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled === true || isLoading}
      aria-busy={isLoading || undefined}
      className={`${button({ variant, size })}${className === undefined ? '' : ` ${className}`}`}
    >
      {isLoading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}
```

`size="icon"` needs an `aria-label`; the type does not enforce it (a discriminated union here would make every ordinary call site noisier for one rule), so it is the accessibility checklist's job — Task 16 turns that checklist into `docs/design/guidelines.md`.

- [ ] **Step 4: Create the barrel**

`apps/web/src/ui/index.ts`:

```ts
export { Button } from './Button'
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- Button
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui
git commit -m "feat(web): add the Button component"
```

---

### Task 4: `Badge`, and the two domain tone maps

**Files:**
- Create: `apps/web/src/ui/Badge.tsx`
- Create: `apps/web/src/ui/Badge.test.tsx`
- Create: `apps/web/src/obligations/urgencyTone.ts`
- Create: `apps/web/src/billing/ageingTone.ts`
- Modify: `apps/web/src/billing/api.ts` (extract the `AgeingBucket` union to a named type)
- Modify: `apps/web/src/ui/index.ts`

**Interfaces:**
- Consumes: Task 1's tokens.
- Produces: `Badge`, `type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'severe' | 'danger'`; `URGENCY_TONE: Record<UrgencyGroup, BadgeTone>` (Task 13); `AGEING_TONE: Record<AgeingBucket, BadgeTone>` and `type AgeingBucket` (Task 14).

`Badge` knows tones. It does not know what an urgency group or an ageing bucket is — that mapping lives with its feature, which is what keeps `ui/` domain-free.

- [ ] **Step 1: Write the failing test**

`apps/web/src/ui/Badge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from './Badge'

describe('Badge', () => {
  it('renders its content', () => {
    render(<Badge tone="danger">Atrasadas</Badge>)
    expect(screen.getByText('Atrasadas')).toBeInTheDocument()
  })

  it('uses the tint-and-700-text pairing for each tone', () => {
    render(<Badge tone="warning">Esta semana</Badge>)
    const badge = screen.getByText('Esta semana')
    expect(badge.className).toContain('bg-warning-50')
    expect(badge.className).toContain('text-warning-700')
  })

  it('renders a pill when asked, and a tag by default', () => {
    const { rerender } = render(<Badge>tag</Badge>)
    expect(screen.getByText('tag').className).toContain('rounded-control')

    rerender(<Badge shape="pill">pill</Badge>)
    expect(screen.getByText('pill').className).toContain('rounded-full')
  })

  it('strikes through when asked', () => {
    render(<Badge strikethrough>Anulado</Badge>)
    expect(screen.getByText('Anulado').className).toContain('line-through')
  })
})
```

Asserting on class names is normally a smell, and every screen test in this repo avoids it. Here it is the point: `Badge`'s entire job is to map a tone to a class pair, so the class pair is its contract. No screen test asserts on classes.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @ledger-hq/web test -- Badge
```

Expected: FAIL — cannot resolve `./Badge`.

- [ ] **Step 3: Implement `Badge`**

`apps/web/src/ui/Badge.tsx`:

```tsx
import type { ComponentPropsWithoutRef } from 'react'
import { cva } from 'class-variance-authority'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'severe' | 'danger'

const badge = cva('inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold', {
  variants: {
    tone: {
      neutral: 'bg-ground text-muted',
      accent: 'bg-accent-50 text-accent-700',
      success: 'bg-success-50 text-success-700',
      warning: 'bg-warning-50 text-warning-700',
      severe: 'bg-severe-50 text-severe-700',
      danger: 'bg-danger-50 text-danger-700',
    },
    shape: {
      tag: 'rounded-control',
      pill: 'rounded-full border border-current/20',
    },
    strikethrough: { true: 'line-through', false: '' },
  },
  defaultVariants: { tone: 'neutral', shape: 'tag', strikethrough: false },
})

type BadgeProps = ComponentPropsWithoutRef<'span'> & {
  tone?: BadgeTone
  shape?: 'tag' | 'pill'
  strikethrough?: boolean
}

export function Badge({ tone, shape, strikethrough, className, children, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={`${badge({ tone, shape, strikethrough })}${className === undefined ? '' : ` ${className}`}`}
    >
      {children}
    </span>
  )
}
```

- [ ] **Step 4: Extract `AgeingBucket` and write the two tone maps**

In `apps/web/src/billing/api.ts`, the bucket union is inline on `ReceivablesRow`. Give it a name so a `Record` can be typed against it — this adds no runtime code:

```ts
export type AgeingBucket = '0-30' | '31-60' | '61-90' | '90+'

export type ReceivablesRow = {
  clientId: string
  clientName: string
  outstandingCents: number
  oldestDueOn: string
  ageingBucket: AgeingBucket
}
```

`apps/web/src/obligations/urgencyTone.ts`:

```ts
import type { UrgencyGroup } from '@ledger-hq/domain'
import type { BadgeTone } from '../ui'

export const URGENCY_TONE: Record<UrgencyGroup, BadgeTone> = {
  overdue: 'danger',
  thisWeek: 'warning',
  thisMonth: 'neutral',
  later: 'neutral',
}
```

`apps/web/src/billing/ageingTone.ts`:

```ts
import type { BadgeTone } from '../ui'
import type { AgeingBucket } from './api'

// Four buckets need four steps; `severe` is the one the semantic trio
// (success/warning/danger) does not provide.
export const AGEING_TONE: Record<AgeingBucket, BadgeTone> = {
  '0-30': 'neutral',
  '31-60': 'warning',
  '61-90': 'severe',
  '90+': 'danger',
}
```

- [ ] **Step 5: Extend the barrel**

`apps/web/src/ui/index.ts`:

```ts
export { Badge } from './Badge'
export type { BadgeTone } from './Badge'
export { Button } from './Button'
```

- [ ] **Step 6: Run the tests and the typecheck**

```bash
pnpm --filter @ledger-hq/web test -- Badge
pnpm --filter @ledger-hq/web typecheck
```

Expected: PASS, 4 tests; typecheck clean (the `Record` maps are exhaustive, so a missing bucket would fail here).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/ui apps/web/src/obligations/urgencyTone.ts apps/web/src/billing/ageingTone.ts apps/web/src/billing/api.ts
git commit -m "feat(web): add the Badge component and its domain tone maps"
```

---

### Task 5: `Card` and `PageHeader`

**Files:**
- Create: `apps/web/src/ui/Card.tsx`
- Create: `apps/web/src/ui/PageHeader.tsx`
- Create: `apps/web/src/ui/PageHeader.test.tsx`
- Modify: `apps/web/src/ui/index.ts`

**Interfaces:**
- Consumes: Task 1's tokens.
- Produces: `Card` (Tasks 13, 14, 15), `PageHeader` (Task 15).

`Card` gets no test of its own: it is a `div` with a class string and no behaviour, and Task 13's screen test renders it. `PageHeader` gets one, because it owns the page's only `<h1>` and heading order is a real accessibility contract.

- [ ] **Step 1: Write the failing test**

`apps/web/src/ui/PageHeader.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from './PageHeader'

describe('PageHeader', () => {
  it('renders the title as the page heading', () => {
    render(<PageHeader title="Resumo" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Resumo' })).toBeInTheDocument()
  })

  it('renders the description and the actions when given', () => {
    render(<PageHeader title="Resumo" description="quinta-feira" actions={<button type="button">Criar</button>} />)
    expect(screen.getByText('quinta-feira')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Criar' })).toBeInTheDocument()
  })

  it('renders no description element when none is given', () => {
    render(<PageHeader title="Resumo" />)
    expect(screen.queryByRole('paragraph')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @ledger-hq/web test -- PageHeader
```

Expected: FAIL — cannot resolve `./PageHeader`.

- [ ] **Step 3: Implement both**

`apps/web/src/ui/Card.tsx`:

```tsx
import type { ComponentPropsWithoutRef } from 'react'
import { cva } from 'class-variance-authority'

const card = cva('border border-line bg-surface rounded-surface', {
  variants: {
    padding: { none: '', sm: 'p-4', md: 'p-5' },
  },
  defaultVariants: { padding: 'md' },
})

type CardProps = ComponentPropsWithoutRef<'div'> & {
  padding?: 'none' | 'sm' | 'md'
}

export function Card({ padding, className, children, ...rest }: CardProps) {
  return (
    <div {...rest} className={`${card({ padding })}${className === undefined ? '' : ` ${className}`}`}>
      {children}
    </div>
  )
}
```

`apps/web/src/ui/PageHeader.tsx`:

```tsx
import type { ReactNode } from 'react'

type PageHeaderProps = {
  title: string
  description?: string
  actions?: ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && <p className="text-sm text-muted">{description}</p>}
      </div>
      {actions !== undefined && <div className="flex items-center gap-4">{actions}</div>}
    </header>
  )
}
```

- [ ] **Step 4: Extend the barrel**

```ts
export { Badge } from './Badge'
export type { BadgeTone } from './Badge'
export { Button } from './Button'
export { Card } from './Card'
export { PageHeader } from './PageHeader'
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- PageHeader
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui
git commit -m "feat(web): add the Card and PageHeader components"
```

---

### Task 6: `Skeleton` and `EmptyState`

**Files:**
- Create: `apps/web/src/ui/Skeleton.tsx`
- Create: `apps/web/src/ui/Skeleton.test.tsx`
- Create: `apps/web/src/ui/EmptyState.tsx`
- Create: `apps/web/src/ui/EmptyState.test.tsx`
- Modify: `apps/web/src/ui/index.ts`

**Interfaces:**
- Consumes: Task 5's `Card`.
- Produces: `Skeleton` (Tasks 13, 14, 15), `EmptyState` (Tasks 13, 14).

- [ ] **Step 1: Write both failing tests**

`apps/web/src/ui/Skeleton.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Skeleton } from './Skeleton'

describe('Skeleton', () => {
  // The loading state is announced once by the region's own aria-busy.
  // A dozen shimmering boxes must not each announce themselves.
  it('is hidden from assistive technology', () => {
    const { container } = render(<Skeleton width="4rem" height="1rem" />)
    const block = container.firstElementChild
    expect(block).toHaveAttribute('aria-hidden', 'true')
  })

  it('applies the given dimensions', () => {
    const { container } = render(<Skeleton width="4rem" height="2rem" />)
    const block = container.firstElementChild as HTMLElement
    expect(block.style.width).toBe('4rem')
    expect(block.style.height).toBe('2rem')
  })
})
```

`apps/web/src/ui/EmptyState.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { CircleCheck } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders the title and the description', () => {
    render(<EmptyState icon={CircleCheck} title="Sem obrigações pendentes." description="Aparecem aqui mais tarde." />)
    expect(screen.getByText('Sem obrigações pendentes.')).toBeInTheDocument()
    expect(screen.getByText('Aparecem aqui mais tarde.')).toBeInTheDocument()
  })

  it('renders no action when none is given', () => {
    render(<EmptyState icon={CircleCheck} title="Sem obrigações pendentes." />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders the action when given', () => {
    render(<EmptyState icon={CircleCheck} title="Sem clientes." action={<button type="button">Criar</button>} />)
    expect(screen.getByRole('button', { name: 'Criar' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm --filter @ledger-hq/web test -- "Skeleton|EmptyState"
```

Expected: FAIL — neither module resolves.

- [ ] **Step 3: Implement both**

`apps/web/src/ui/Skeleton.tsx`:

```tsx
import type { ComponentPropsWithoutRef } from 'react'

type SkeletonProps = Omit<ComponentPropsWithoutRef<'span'>, 'style'> & {
  width?: string
  height?: string
}

export function Skeleton({ width = '100%', height = '1rem', className, ...rest }: SkeletonProps) {
  return (
    <span
      {...rest}
      aria-hidden="true"
      style={{ width, height }}
      className={`block animate-pulse rounded-control bg-line${className === undefined ? '' : ` ${className}`}`}
    />
  )
}
```

The pulse is disabled under `prefers-reduced-motion` by the rule Task 1 put in `styles.css`.

`apps/web/src/ui/EmptyState.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card } from './Card'

type EmptyStateProps = {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-700">
        <Icon aria-hidden="true" className="h-6 w-6" />
      </span>
      <p className="text-base font-semibold">{title}</p>
      {description !== undefined && <p className="max-w-sm text-sm font-normal text-muted">{description}</p>}
      {action}
    </Card>
  )
}
```

- [ ] **Step 4: Extend the barrel**

```ts
export { Badge } from './Badge'
export type { BadgeTone } from './Badge'
export { Button } from './Button'
export { Card } from './Card'
export { EmptyState } from './EmptyState'
export { PageHeader } from './PageHeader'
export { Skeleton } from './Skeleton'
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- "Skeleton|EmptyState"
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui
git commit -m "feat(web): add the Skeleton and EmptyState components"
```

---

### Task 7: `Money`

**Files:**
- Create: `apps/web/src/ui/Money.tsx`
- Create: `apps/web/src/ui/Money.test.tsx`
- Modify: `apps/web/src/ui/index.ts`

**Interfaces:**
- Consumes: `formatCurrency` and `SupportedLocale` from `apps/web/src/i18n/format.ts`.
- Produces: `Money` (Tasks 14, 15).

This task owns **Review Focus 2** (zero and negative zero) and **Review Focus 3** (runtime locale switch).

- [ ] **Step 1: Write the failing test**

`apps/web/src/ui/Money.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { initI18n } from '../i18n'
import { formatCurrency } from '../i18n/format'
import { Money } from './Money'

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderMoney(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18next}>{ui}</I18nextProvider>)
}

describe('Money', () => {
  it('formats through formatCurrency, never on its own', () => {
    renderMoney(<Money cents={214_500} />)
    expect(screen.getByText(formatCurrency(214_500, 'pt-PT'))).toBeInTheDocument()
  })

  it('reads a negative amount as a credit', () => {
    renderMoney(<Money cents={-38_000} />)
    const amount = screen.getByText(formatCurrency(-38_000, 'pt-PT'))
    expect(amount.className).toContain('text-success-700')
  })

  it('reads a positive amount as a debit', () => {
    renderMoney(<Money cents={38_000} />)
    expect(screen.getByText(formatCurrency(38_000, 'pt-PT')).className).toContain('text-ink')
  })

  // Review Focus 2. Zero is not a credit, and -0 must not print a minus.
  it('treats zero as a debit, and never renders a negative zero', () => {
    renderMoney(<Money cents={-0} />)
    const amount = screen.getByText(/0,00/)
    expect(amount.textContent?.startsWith('-')).toBe(false)
    expect(amount.className).toContain('text-ink')
  })

  it('strikes through a written-off amount whatever its sign', () => {
    renderMoney(<Money cents={9_500} tone="writtenOff" />)
    const amount = screen.getByText(formatCurrency(9_500, 'pt-PT'))
    expect(amount.className).toContain('line-through')
    expect(amount.className).toContain('text-subtle')
  })

  // Phase 4's client credit is a POSITIVE balance the client may spend.
  it('lets a caller force the credit tone on a positive amount', () => {
    renderMoney(<Money cents={21_250} tone="credit" />)
    expect(screen.getByText(formatCurrency(21_250, 'pt-PT')).className).toContain('text-success-700')
  })

  // Review Focus 3. A component that reads i18n.language without
  // subscribing keeps the old locale forever.
  it('reformats when the locale changes at runtime', async () => {
    renderMoney(<Money cents={214_500} />)
    expect(screen.getByText(formatCurrency(214_500, 'pt-PT'))).toBeInTheDocument()

    await act(async () => {
      await i18next.changeLanguage('en-GB')
    })

    expect(screen.getByText(formatCurrency(214_500, 'en-GB'))).toBeInTheDocument()
    await act(async () => {
      await i18next.changeLanguage('pt-PT')
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @ledger-hq/web test -- Money
```

Expected: FAIL — cannot resolve `./Money`.

- [ ] **Step 3: Implement**

`apps/web/src/ui/Money.tsx`:

```tsx
import type { ComponentPropsWithoutRef } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCurrency } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'

type MoneyTone = 'auto' | 'credit' | 'debit' | 'writtenOff'

const TONE_CLASS: Record<Exclude<MoneyTone, 'auto'>, string> = {
  credit: 'text-success-700',
  debit: 'text-ink',
  writtenOff: 'text-subtle line-through',
}

const SIZE_CLASS = { sm: 'text-xs', md: 'text-sm', lg: 'text-2xl' } as const

type MoneyProps = ComponentPropsWithoutRef<'span'> & {
  cents: number
  tone?: MoneyTone
  size?: keyof typeof SIZE_CLASS
}

export function Money({ cents, tone = 'auto', size = 'md', className, ...rest }: MoneyProps) {
  // useTranslation, not i18next.language directly: this is what subscribes
  // the component to changeLanguage, so an amount reformats when the user
  // switches locale instead of keeping whichever locale was active at mount.
  const { i18n } = useTranslation()

  // `cents < 0` is false for -0, which is what keeps a negative zero from
  // rendering as a credit; formatCurrency's own output for -0 has no sign.
  const resolved = tone === 'auto' ? (cents < 0 ? 'credit' : 'debit') : tone

  return (
    <span
      {...rest}
      className={`font-medium tabular-nums ${TONE_CLASS[resolved]} ${SIZE_CLASS[size]}${className === undefined ? '' : ` ${className}`}`}
    >
      {formatCurrency(cents, i18n.language as SupportedLocale)}
    </span>
  )
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- Money
```

Expected: PASS, 7 tests.

If the negative-zero test fails because `Intl.NumberFormat` renders `-0` as `-0,00 €` on this ICU build, normalise at the boundary — `const safe = cents === 0 ? 0 : cents` before formatting — and keep the test.

- [ ] **Step 5: Extend the barrel and commit**

Add `export { Money } from './Money'` in alphabetical position.

```bash
git add apps/web/src/ui
git commit -m "feat(web): add the Money component"
```

---

### Task 8: `DataList`

**Files:**
- Create: `apps/web/src/ui/DataList.tsx`
- Create: `apps/web/src/ui/DataList.test.tsx`
- Modify: `apps/web/src/ui/index.ts`

**Interfaces:**
- Consumes: Task 1's tokens.
- Produces: `DataList`, `DataList.Row`, `DataList.Total` (Task 14).

Both slots take `ReactNode` — that is what lets a label be a link and a value be a badge beside an amount. `DataList` knows nothing about money. Rows render as `div`s, not `<dl>`: a `<dt>` holding a navigation link reads oddly, and the section's heading already carries the structure. Stage 3's client-detail facts are a genuine description list and may revisit this.

- [ ] **Step 1: Write the failing test**

`apps/web/src/ui/DataList.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataList } from './DataList'

describe('DataList', () => {
  it('renders both slots of a row', () => {
    render(
      <DataList>
        <DataList.Row label={<span>Nordeste Têxteis</span>} value={<span>6 450,00 €</span>} />
      </DataList>,
    )
    expect(screen.getByText('Nordeste Têxteis')).toBeInTheDocument()
    expect(screen.getByText('6 450,00 €')).toBeInTheDocument()
  })

  it('renders an interactive label, so a row can be a navigation target', () => {
    render(
      <DataList>
        <DataList.Row label={<a href="/clients/c1">Padaria Manso</a>} value={<span>3 180,00 €</span>} />
      </DataList>,
    )
    expect(screen.getByRole('link', { name: 'Padaria Manso' })).toHaveAttribute('href', '/clients/c1')
  })

  it('marks the total apart from an ordinary row', () => {
    render(
      <DataList>
        <DataList.Row label={<span>Uma linha</span>} value={<span>1,00 €</span>} />
        <DataList.Total label="Total" value={<span>1,00 €</span>} />
      </DataList>,
    )
    const total = screen.getByText('Total')
    expect(total.className).toContain('font-semibold')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @ledger-hq/web test -- DataList
```

Expected: FAIL — cannot resolve `./DataList`.

- [ ] **Step 3: Implement**

`apps/web/src/ui/DataList.tsx`:

```tsx
import type { ReactNode } from 'react'

function DataListRoot({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <span className="flex shrink-0 items-center gap-3 text-sm">{value}</span>
    </div>
  )
}

function Total({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-4 border-t border-line-strong pt-3">
      <span className="text-sm font-semibold">{label}</span>
      <span className="flex shrink-0 items-center gap-3 text-sm font-semibold">{value}</span>
    </div>
  )
}

export const DataList = Object.assign(DataListRoot, { Row, Total })
```

`truncate` on the label slot is what keeps a long client name from pushing the amount out of the row — Review Focus 4, asserted in Task 14 against a real name.

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- DataList
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Extend the barrel and commit**

Add `export { DataList } from './DataList'`.

```bash
git add apps/web/src/ui
git commit -m "feat(web): add the DataList component"
```

---

### Task 9: `DropdownMenu`

**Files:**
- Create: `apps/web/src/ui/DropdownMenu.tsx`
- Modify: `apps/web/src/ui/index.ts`

**Interfaces:**
- Consumes: `@radix-ui/react-dropdown-menu` (Task 1).
- Produces: `DropdownMenu` with `.Trigger`, `.Content`, `.Item`, `.Label`, `.Separator`, `.RadioGroup`, `.RadioItem` (Task 10).

No test of its own: this file is styling applied to Radix's primitives, and Radix tests its own behaviour. Task 10's `AccountMenu` test exercises the composition — opening, Escape, focus return — which is where a mistake would actually live.

- [ ] **Step 1: Implement**

`apps/web/src/ui/DropdownMenu.tsx`:

```tsx
import type { ComponentPropsWithoutRef } from 'react'
import * as RadixDropdownMenu from '@radix-ui/react-dropdown-menu'

const ITEM_CLASS =
  'flex h-[34px] cursor-pointer select-none items-center gap-2 rounded-control px-3 text-sm outline-none data-[highlighted]:bg-ground'

function Content({ className, children, ...rest }: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Content>) {
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.Content
        align="end"
        sideOffset={6}
        {...rest}
        className={`min-w-[12rem] rounded-surface border border-line bg-surface p-1.5 shadow-overlay${className === undefined ? '' : ` ${className}`}`}
      >
        {children}
      </RadixDropdownMenu.Content>
    </RadixDropdownMenu.Portal>
  )
}

function Item({ className, ...rest }: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Item>) {
  return <RadixDropdownMenu.Item {...rest} className={`${ITEM_CLASS}${className === undefined ? '' : ` ${className}`}`} />
}

function RadioItem({ className, ...rest }: ComponentPropsWithoutRef<typeof RadixDropdownMenu.RadioItem>) {
  return (
    <RadixDropdownMenu.RadioItem
      {...rest}
      className={`${ITEM_CLASS} data-[state=checked]:font-semibold${className === undefined ? '' : ` ${className}`}`}
    />
  )
}

function Label({ className, ...rest }: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Label>) {
  return (
    <RadixDropdownMenu.Label
      {...rest}
      className={`px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted${className === undefined ? '' : ` ${className}`}`}
    />
  )
}

function Separator({ className, ...rest }: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Separator>) {
  return (
    <RadixDropdownMenu.Separator
      {...rest}
      className={`my-1.5 h-px bg-line${className === undefined ? '' : ` ${className}`}`}
    />
  )
}

export const DropdownMenu = Object.assign(RadixDropdownMenu.Root, {
  Trigger: RadixDropdownMenu.Trigger,
  Content,
  Item,
  Label,
  Separator,
  RadioGroup: RadixDropdownMenu.RadioGroup,
  RadioItem,
})
```

- [ ] **Step 2: Extend the barrel and typecheck**

Add `export { DropdownMenu } from './DropdownMenu'`.

```bash
pnpm --filter @ledger-hq/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/ui
git commit -m "feat(web): add the DropdownMenu component"
```

---

### Task 10: `AccountMenu`, replacing the loose header controls

**Files:**
- Create: `apps/web/src/shell/AccountMenu.tsx`
- Create: `apps/web/src/shell/AccountMenu.test.tsx`
- Delete: `apps/web/src/shell/LanguageSwitcher.tsx`

**Interfaces:**
- Consumes: Task 9's `DropdownMenu`, Task 3's `Button`; `SUPPORTED_LOCALES` and `setLocale` from `../i18n`; `signOut` from `../auth/credentials`; `SESSION_QUERY_KEY` from `../auth/session`; `lockVault`, `useVaultState` from `../vault/vault-session`.
- Produces: `AccountMenu` (Task 11).

The language `<select>`, the lock-vault button and the sign-out button move here from `AppLayout` unchanged in behaviour. `LanguageSwitcher.tsx` is deleted — its whole body is three lines that now live as radio items. It has no test of its own to delete.

- [ ] **Step 1: Write the failing test**

`apps/web/src/shell/AccountMenu.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import type * as CredentialsModule from '../auth/credentials'

const signOut = vi.hoisted(() => vi.fn())
vi.mock('../auth/credentials', async (importOriginal) => {
  const actual = await importOriginal<typeof CredentialsModule>()
  return { ...actual, signOut }
})

const { AccountMenu } = await import('./AccountMenu')
const { lockVault, unlockVault } = await import('../vault/vault-session')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderMenu() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <AccountMenu />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('AccountMenu', () => {
  beforeEach(() => {
    signOut.mockReset()
    signOut.mockResolvedValue(undefined)
    lockVault()
  })

  it('opens on click and closes on Escape, returning focus to the trigger', async () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: /conta/i })

    await userEvent.click(trigger)
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('shows the lock-vault item only once the vault is unlocked', async () => {
    renderMenu()

    await userEvent.click(screen.getByRole('button', { name: /conta/i }))
    expect(screen.queryByRole('menuitem', { name: /bloquear cofre/i })).not.toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    unlockVault({ type: 'secret' } as CryptoKey)

    await userEvent.click(screen.getByRole('button', { name: /conta/i }))
    expect(await screen.findByRole('menuitem', { name: /bloquear cofre/i })).toBeInTheDocument()

    lockVault()
  })

  it('signs out through the real signOut', async () => {
    renderMenu()

    await userEvent.click(screen.getByRole('button', { name: /conta/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /sair/i }))

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
  })

  it('switches locale from the language radio items', async () => {
    renderMenu()

    await userEvent.click(screen.getByRole('button', { name: /conta/i }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'English' }))

    await waitFor(() => expect(i18next.language).toBe('en-GB'))
    await i18next.changeLanguage('pt-PT')
  })
})
```

**The trigger's accessible name is the session email.** There is no key that means "account menu", and adding one to name a control whose whole content is *this user* would be worse than using the user's own email, which `useSession()` already provides. So: `aria-label={email}`, no sixth key, and a more informative name than "Account" would have been. The test above therefore queries `{ name: /conta/i }` — **replace all four of those queries with `{ name: /paulo@example\.com/i }`** and drive `useSession` from a mocked network, exactly as `AppLayout.test.tsx` does it:

```tsx
const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>()
  return { ...actual, apiFetch }
})

// in beforeEach:
apiFetch.mockImplementation(async (path: string) => {
  if (path === '/auth/session') return { id: '1', email: 'paulo@example.com', locale: 'pt-PT' }
  if (path === '/auth/logout') return undefined
  throw new Error(`unexpected path in test: ${path}`)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @ledger-hq/web test -- AccountMenu
```

Expected: FAIL — cannot resolve `./AccountMenu`.

- [ ] **Step 3: Implement**

`apps/web/src/shell/AccountMenu.tsx`:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LogOut, Lock } from 'lucide-react'
import { DropdownMenu } from '../ui'
import { SUPPORTED_LOCALES, setLocale } from '../i18n'
import type { SupportedLocale } from '../i18n'
import { signOut } from '../auth/credentials'
import { SESSION_QUERY_KEY, useSession } from '../auth/session'
import { lockVault, useVaultState } from '../vault/vault-session'

function initialsOf(email: string): string {
  return email.slice(0, 2).toUpperCase()
}

export function AccountMenu() {
  const { t, i18n } = useTranslation('common')
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
        <DropdownMenu.RadioGroup
          value={i18n.language}
          onValueChange={(value) => void setLocale(value as SupportedLocale)}
        >
          {SUPPORTED_LOCALES.map((locale) => (
            <DropdownMenu.RadioItem key={locale} value={locale}>
              {t(`language.${locale}`)}
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>

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

- [ ] **Step 4: Delete `LanguageSwitcher.tsx`**

```bash
git rm apps/web/src/shell/LanguageSwitcher.tsx
```

`AppLayout` still imports it at this point, so the build is red until Task 11. If you would rather keep every commit green, do Tasks 10 and 11 in one commit — say so in the commit message.

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- AccountMenu
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/shell
git commit -m "feat(web): move the account controls into a dropdown menu"
```

---

### Task 11: The shell — `Sidebar`, `MobileNav`, and `AppLayout`

**Files:**
- Create: `apps/web/src/shell/Sidebar.tsx`
- Create: `apps/web/src/shell/MobileNav.tsx`
- Modify: `apps/web/src/shell/AppLayout.tsx` (full rewrite)
- Modify: `apps/web/src/shell/AppLayout.test.tsx`
- Modify: `apps/web/src/i18n/locales/pt/common.json`, `apps/web/src/i18n/locales/en/common.json` (remove `nav.platforms`)

**Interfaces:**
- Consumes: Task 10's `AccountMenu`, Task 12's `ConnectionStatus` (unchanged import path), `Link`/`useRouterState` from `@tanstack/react-router`.
- Produces: the shell every screen renders inside.

Three destinations, one list, used by both nav components:

```ts
const DESTINATIONS = [
  { to: '/', labelKey: 'nav.deadlines', icon: CalendarCheck },
  { to: '/clients', labelKey: 'nav.clients', icon: Users },
  { to: '/vault/platforms', labelKey: 'nav.vault', icon: Vault },
] as const
```

`nav.deadlines` does not exist. Rather than add a sixth key, the first item reuses `obligations:dashboard.title` ("Prazos" / "Deadlines") — it is the same word for the same screen, already translated. Import it with `useTranslation(['common', 'obligations'])` and reference it as `obligations:dashboard.title`.

- [ ] **Step 1: Update the existing `AppLayout` test for the menu**

In `apps/web/src/shell/AppLayout.test.tsx`, both tests reach for buttons that now live inside the account menu. Open the menu first. In the sign-out test, replace:

```tsx
await userEvent.click(screen.getByRole('button', { name: /sair|sign out/i }))
```

with:

```tsx
await userEvent.click(screen.getByRole('button', { name: /paulo@example\.com/i }))
await userEvent.click(await screen.findByRole('menuitem', { name: /sair|sign out/i }))
```

And in the lock-vault test, replace the two `queryByRole`/`findByRole` button assertions with the same open-then-query shape, using `menuitem` instead of `button`. Every other line of both tests — the fake network, the `signOut` assertion, the login-heading assertion — stays exactly as it is.

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm --filter @ledger-hq/web test -- AppLayout
```

Expected: FAIL — there is no button named after the email yet.

- [ ] **Step 3: Write `Sidebar`**

`apps/web/src/shell/Sidebar.tsx`:

```tsx
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, Users, Vault } from 'lucide-react'
import { AccountMenu } from './AccountMenu'

const DESTINATIONS = [
  { to: '/', labelKey: 'obligations:dashboard.title', icon: CalendarCheck },
  { to: '/clients', labelKey: 'common:nav.clients', icon: Users },
  { to: '/vault/platforms', labelKey: 'common:nav.vault', icon: Vault },
] as const

export function Sidebar() {
  const { t } = useTranslation(['common', 'obligations'])

  return (
    <nav
      aria-label={t('common:appName')}
      className="hidden w-60 shrink-0 flex-col gap-8 border-r border-line bg-surface p-4 md:flex"
    >
      <span className="flex items-center gap-2.5 px-2 text-base font-semibold tracking-tight">
        <span className="flex h-6 w-6 items-center justify-center rounded-control bg-accent-600 text-xs font-semibold text-white">
          L
        </span>
        {t('common:appName')}
      </span>

      <div className="flex flex-1 flex-col gap-1">
        {DESTINATIONS.map(({ to, labelKey, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === '/' }}
            className="flex items-center gap-2.5 rounded-surface px-2.5 py-2 text-sm font-medium text-muted hover:bg-ground"
            activeProps={{
              className:
                'flex items-center gap-2.5 rounded-surface bg-accent-50 px-2.5 py-2 text-sm font-medium text-accent-700',
              'aria-current': 'page',
            }}
          >
            <Icon aria-hidden="true" className="h-5 w-5" />
            {t(labelKey)}
          </Link>
        ))}
      </div>

      <AccountMenu />
    </nav>
  )
}
```

- [ ] **Step 4: Write `MobileNav`**

`apps/web/src/shell/MobileNav.tsx`:

```tsx
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, Users, Vault } from 'lucide-react'
import { AccountMenu } from './AccountMenu'
import { ConnectionStatus } from './ConnectionStatus'

const DESTINATIONS = [
  { to: '/', labelKey: 'obligations:dashboard.title', icon: CalendarCheck },
  { to: '/clients', labelKey: 'common:nav.clients', icon: Users },
  { to: '/vault/platforms', labelKey: 'common:nav.vault', icon: Vault },
] as const

export function MobileTopBar() {
  const { t } = useTranslation('common')

  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b border-line bg-surface px-4 md:hidden">
      <span className="text-base font-semibold tracking-tight">{t('appName')}</span>
      <span className="flex items-center gap-2">
        <ConnectionStatus />
        <AccountMenu />
      </span>
    </header>
  )
}

export function MobileTabBar() {
  const { t } = useTranslation(['common', 'obligations'])

  return (
    <nav
      aria-label={t('common:appName')}
      className="fixed inset-x-0 bottom-0 flex items-center border-t border-line bg-surface px-4 pb-2 md:hidden"
    >
      {DESTINATIONS.map(({ to, labelKey, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          aria-label={t(labelKey)}
          activeOptions={{ exact: to === '/' }}
          className="flex h-[52px] flex-1 items-center justify-center rounded-surface text-muted"
          activeProps={{
            className: 'flex h-[52px] flex-1 items-center justify-center rounded-surface text-accent-700',
            'aria-current': 'page',
          }}
        >
          <Icon aria-hidden="true" className="h-6 w-6" />
        </Link>
      ))}
    </nav>
  )
}
```

The tabs are icon-only, so each carries an `aria-label` from the same key its desktop twin shows as text.

- [ ] **Step 5: Rewrite `AppLayout`**

`apps/web/src/shell/AppLayout.tsx`, in full:

```tsx
import { Outlet } from '@tanstack/react-router'
import { ConnectionStatus } from './ConnectionStatus'
import { Sidebar } from './Sidebar'
import { MobileTabBar, MobileTopBar } from './MobileNav'
import { RequireSession } from '../router'
import { useVaultSync } from '../vault/useVaultSync'

export function AppLayout() {
  useVaultSync()

  return (
    <div className="flex min-h-dvh bg-ground text-ink">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar />

        <div className="hidden justify-end px-6 pt-6 md:flex">
          <ConnectionStatus />
        </div>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 md:px-6 md:pb-8">
          <RequireSession>
            <Outlet />
          </RequireSession>
        </main>

        <MobileTabBar />
      </div>
    </div>
  )
}
```

`pb-24` on mobile keeps the fixed tab bar from covering the last row of content. `useVaultSync()` stays here — it is a whole-app concern, unlike the sign-out mutation, which moved to `AccountMenu` with the button that triggers it.

- [ ] **Step 6: Remove the dead `nav.platforms` key**

Nothing references it now. Delete the `"platforms"` entry from the `nav` object in both `pt/common.json` and `en/common.json`. `i18n:check` compares the two bundles against each other, not against usage, so a stale key would pass silently forever — removing it in this commit is the only thing that keeps the bundles honest.

```bash
grep -rn "nav.platforms" apps/web/src
```

Expected: no output.

- [ ] **Step 7: Run everything, the end-to-end suite included**

```bash
pnpm --filter @ledger-hq/web test
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web i18n:check
pnpm --filter @ledger-hq/web test:e2e
```

Expected: all PASS.

The e2e run matters here more than anywhere else in this plan. Every existing spec navigates with `page.getByRole('link', { name: /clientes/i })`, and this task is the one that changes what that resolves to. Two links now carry that name — the sidebar's text link and the tab bar's `aria-label`ed icon — and only one is in the accessibility tree at a time, because Tailwind's `hidden` and `md:hidden` are `display: none`, which removes an element from that tree. If instead you see Playwright's strict-mode error ("resolved to 2 elements"), the nav is being hidden by something other than `display: none` — fix the hiding, not the specs.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/shell apps/web/src/i18n/locales
git commit -m "feat(web): rebuild the app shell around a sidebar and a tab bar"
```

---

### Task 12: `ConnectionStatus` becomes a pill

**Files:**
- Modify: `apps/web/src/shell/ConnectionStatus.tsx` (render only)
- Modify: `apps/web/src/shell/ConnectionStatus.test.tsx`

**Interfaces:**
- Consumes: Task 4's `Badge`.
- Produces: nothing new.

This task owns **Review Focus 5**. The logic — returning `null` when online, computing `lastUpdated` from the query cache — does not change at all. Only the markup does.

- [ ] **Step 1: Add the failing test for the empty-cache case**

Append to `apps/web/src/shell/ConnectionStatus.test.tsx` (read the existing file first for its offline-mocking helper and reuse it):

```tsx
  // Review Focus 5. With nothing in the cache, lastUpdated is 0 and the
  // "last synchronised" fragment must be absent, not an epoch date.
  it('omits the last-synchronised line when nothing has ever loaded', async () => {
    // render offline with a fresh, empty QueryClient
    renderOffline(new QueryClient())

    expect(await screen.findByRole('status')).toHaveTextContent(/sem ligação ao servidor/i)
    expect(screen.queryByText(/sincronizado/i)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run it**

```bash
pnpm --filter @ledger-hq/web test -- ConnectionStatus
```

Expected: PASS already — this is existing behaviour, and the test is here to pin it before the markup changes underneath it. If it fails, the current component has a bug; fix that first and say so.

- [ ] **Step 3: Change the render**

In `ConnectionStatus.tsx`, keep every line down to and including the `time` computation. Replace only the returned JSX:

```tsx
  return (
    <Badge shape="pill" tone="danger" role="status">
      <WifiOff aria-hidden="true" className="h-3.5 w-3.5" />
      {t('connection.offline')}
      {time === '' ? null : <span className="sr-only">{t('connection.lastSync', { time })}</span>}
    </Badge>
  )
```

with `import { WifiOff } from 'lucide-react'` and `import { Badge } from '../ui'` at the top. The last-sync line stays inside the same `role="status"` element as visually-hidden text: a screen reader still hears it, and the pill stays the size of a pill.

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- ConnectionStatus
```

Expected: PASS. The existing assertions query by `role="status"` and by text, both of which survive.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/shell/ConnectionStatus.tsx apps/web/src/shell/ConnectionStatus.test.tsx
git commit -m "refactor(web): render the connection status as a pill"
```

---

### Task 13: `ObligationsDashboard`

**Files:**
- Modify: `apps/web/src/obligations/ObligationsDashboard.tsx`
- Create: `apps/web/src/obligations/ObligationsDashboardSkeleton.tsx`
- Modify: `apps/web/src/obligations/ObligationsDashboard.test.tsx`

**Interfaces:**
- Consumes: `Badge`, `Card`, `EmptyState`, `Skeleton` from `../ui`; `URGENCY_TONE` from `./urgencyTone`.
- Produces: nothing new.

Two behaviour changes: the blank screen during loading becomes a skeleton, and the `<h1>` becomes an `<h2>` because `HomePage` now owns the page's heading. `ObligationRow` is not touched.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/obligations/ObligationsDashboard.test.tsx`:

```tsx
  it('shows a skeleton while loading, not a blank screen', async () => {
    // A promise that never settles: the query stays pending.
    listObligationsMock.mockReturnValue(new Promise(() => {}))
    const { container } = renderDashboard()

    await waitFor(() => {
      expect(container.querySelectorAll('[aria-hidden="true"].animate-pulse').length).toBeGreaterThan(0)
    })
  })

  it('renders the section heading below the page heading, not as an h1', async () => {
    listObligationsMock.mockResolvedValue([])
    renderDashboard()

    expect(await screen.findByRole('heading', { level: 2, name: /prazos/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('describes the empty state, not just states it', async () => {
    listObligationsMock.mockResolvedValue([])
    renderDashboard()

    expect(await screen.findByText(/sem obrigações pendentes/i)).toBeInTheDocument()
    expect(screen.getByText(/gerador do catálogo/i)).toBeInTheDocument()
  })
```

Add `waitFor` to the `@testing-library/react` import if it is not there.

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm --filter @ledger-hq/web test -- ObligationsDashboard
```

Expected: FAIL — no pulse elements, and the heading is still an `h1`.

- [ ] **Step 3: Write the skeleton**

`apps/web/src/obligations/ObligationsDashboardSkeleton.tsx`:

```tsx
import { Card, Skeleton } from '../ui'

export function ObligationsDashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton width="6rem" height="1.25rem" />
      {[0, 1, 2].map((row) => (
        <Card key={row} padding="sm" className="flex items-center gap-4">
          <Skeleton height="0.875rem" />
          <Skeleton width="5rem" height="0.875rem" />
          <Skeleton width="6.5rem" height="1.75rem" />
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Restyle the dashboard**

In `ObligationsDashboard.tsx`:

- Replace `if (obligations.isPending) return null` with
  `if (obligations.isPending) return <ObligationsDashboardSkeleton />`.
- Change both `<h1 className="text-lg font-semibold">{t('dashboard.title')}</h1>` occurrences to
  `<h2 className="text-lg font-semibold">{t('dashboard.title')}</h2>`.
- Replace the empty branch's `<p>` with:

```tsx
      <EmptyState
        icon={CircleCheck}
        title={t('dashboard.empty')}
        description={t('dashboard.emptyHint')}
      />
```

- Replace each group heading with a badge carrying the count:

```tsx
        <div key={key} className="flex flex-col gap-2">
          <Badge tone={URGENCY_TONE[key]} className="self-start">
            {t(`dashboard.${key}`)} · {groups[key].length}
          </Badge>
          <ul className="flex flex-col gap-2">
            {/* unchanged */}
          </ul>
        </div>
```

- Wrap the section in `className="flex flex-col gap-6"` (it already is) and leave `ErrorMessage` and the `markDone` mutation exactly as they are.

New imports: `import { CircleCheck } from 'lucide-react'`, `import { Badge, EmptyState } from '../ui'`, `import { URGENCY_TONE } from './urgencyTone'`, `import { ObligationsDashboardSkeleton } from './ObligationsDashboardSkeleton'`.

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- ObligationsDashboard
```

Expected: PASS — the three new tests plus every existing one.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/obligations
git commit -m "feat(web): give the obligations dashboard loading and empty states"
```

---

### Task 14: `ReceivablesSection`

**Files:**
- Modify: `apps/web/src/billing/ReceivablesSection.tsx`
- Create: `apps/web/src/billing/ReceivablesSectionSkeleton.tsx`
- Modify: `apps/web/src/billing/ReceivablesSection.test.tsx`

**Interfaces:**
- Consumes: `Badge`, `Card`, `DataList`, `EmptyState`, `Money`, `Skeleton` from `../ui`; `AGEING_TONE` from `./ageingTone`; `Link` from `@tanstack/react-router`.
- Produces: nothing new.

This task owns **Review Focus 4**.

**The gotcha that will bite you:** the client name becomes a `Link`, and `@tanstack/react-router`'s `Link` throws outside a router. The existing test renders `<ReceivablesSection />` bare. It needs a memory router around it — copy the `createMemoryHistory`/`createRootRoute`/`createRouter` helper out of `apps/web/src/shell/AppLayout.test.tsx` and render the section as the index route's component.

- [ ] **Step 1: Wrap the existing test in a router and add the new cases**

Rewrite `renderSection()` in `apps/web/src/billing/ReceivablesSection.test.tsx`:

```tsx
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: ReceivablesSection })
  const clientRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/clients/$clientId',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, clientRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}
```

Then add:

```tsx
  it('links each client name to its detail page', async () => {
    getReceivablesMock.mockResolvedValue([
      { clientId: 'c1', clientName: 'Padaria Central', outstandingCents: 27_000, oldestDueOn: '2026-01-08', ageingBucket: '61-90' },
    ])
    renderSection()

    const link = await screen.findByRole('link', { name: /padaria central/i })
    expect(link).toHaveAttribute('href', '/clients/c1')
  })

  it('shows the total of every outstanding balance', async () => {
    getReceivablesMock.mockResolvedValue([
      { clientId: 'c1', clientName: 'Padaria Central', outstandingCents: 27_000, oldestDueOn: '2026-01-08', ageingBucket: '61-90' },
      { clientId: 'c2', clientName: 'Clínica Aurora', outstandingCents: 13_000, oldestDueOn: '2026-03-02', ageingBucket: '0-30' },
    ])
    renderSection()

    expect(await screen.findByText(formatCurrency(40_000, 'pt-PT'))).toBeInTheDocument()
  })

  // Review Focus 4. A long name must truncate, not shove the amount out of
  // the row: the amount has to stay on screen for the row to be worth having.
  it('truncates a long client name instead of pushing the amount out', async () => {
    getReceivablesMock.mockResolvedValue([
      {
        clientId: 'c1',
        clientName: 'Sociedade de Construções e Empreitadas do Vale do Sousa, Unipessoal Lda',
        outstandingCents: 27_000,
        oldestDueOn: '2026-01-08',
        ageingBucket: '61-90',
      },
    ])
    renderSection()

    const link = await screen.findByRole('link', { name: /sociedade de construções/i })
    expect(link.closest('span')?.className).toContain('truncate')
    expect(screen.getByText(formatCurrency(27_000, 'pt-PT'))).toBeInTheDocument()
  })

  it('shows a skeleton while loading', async () => {
    getReceivablesMock.mockReturnValue(new Promise(() => {}))
    const { container } = renderSection()

    await waitFor(() => {
      expect(container.querySelectorAll('[aria-hidden="true"].animate-pulse').length).toBeGreaterThan(0)
    })
  })
```

Import `formatCurrency` from `../i18n/format` and `waitFor` from `@testing-library/react`.

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm --filter @ledger-hq/web test -- ReceivablesSection
```

Expected: FAIL — there is no link, no total, no skeleton.

- [ ] **Step 3: Write the skeleton**

`apps/web/src/billing/ReceivablesSectionSkeleton.tsx`:

```tsx
import { Card, Skeleton } from '../ui'

export function ReceivablesSectionSkeleton() {
  return (
    <Card padding="none" className="px-5" aria-busy="true">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex min-h-[44px] items-center justify-between gap-4 border-b border-line py-3 last:border-b-0">
          <Skeleton height="0.875rem" />
          <Skeleton width="5rem" height="1.25rem" />
          <Skeleton width="5.5rem" height="0.875rem" />
        </div>
      ))}
    </Card>
  )
}
```

- [ ] **Step 4: Rewrite the section's render**

`apps/web/src/billing/ReceivablesSection.tsx`, keeping the query exactly as it is:

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Coins } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Badge, Card, DataList, EmptyState, Money } from '../ui'
import { getReceivables } from './api'
import { AGEING_TONE } from './ageingTone'
import { ReceivablesSectionSkeleton } from './ReceivablesSectionSkeleton'

export function ReceivablesSection() {
  const { t } = useTranslation('billing')

  const receivables = useQuery({ queryKey: ['receivables'], queryFn: getReceivables })

  if (receivables.isPending) return <ReceivablesSectionSkeleton />
  if (receivables.isError) return <ErrorMessage error={receivables.error} />

  const total = receivables.data.reduce((sum, row) => sum + row.outstandingCents, 0)

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('receivables.title')}</h2>

      {receivables.data.length === 0 ? (
        <EmptyState icon={Coins} title={t('receivables.empty')} description={t('receivables.emptyHint')} />
      ) : (
        <Card padding="none" className="px-5">
          <DataList>
            {receivables.data.map((row) => (
              <DataList.Row
                key={row.clientId}
                label={
                  <Link to="/clients/$clientId" params={{ clientId: row.clientId }} className="font-medium">
                    {row.clientName}
                  </Link>
                }
                value={
                  <>
                    <Badge tone={AGEING_TONE[row.ageingBucket]}>{t(`receivables.bucket.${row.ageingBucket}`)}</Badge>
                    <Money cents={row.outstandingCents} />
                  </>
                }
              />
            ))}
            <DataList.Total label={t('receivables.title')} value={<Money cents={total} />} />
          </DataList>
        </Card>
      )}
    </section>
  )
}
```

The total's label reuses `receivables.title` rather than adding a sixth key — "Recebíveis / 40 000,00 €" as a footer row reads correctly and adds nothing to translate.

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @ledger-hq/web test -- ReceivablesSection
```

Expected: PASS — four new tests plus the two existing ones.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/billing
git commit -m "feat(web): restyle the receivables section and link its clients"
```

---

### Task 15: `HomePage` and `SummaryRow`

**Files:**
- Modify: `apps/web/src/HomePage.tsx`
- Create: `apps/web/src/home/SummaryRow.tsx`
- Create: `apps/web/src/HomePage.test.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `Card`, `Skeleton`, `Money` from `./ui`; `groupByUrgency` from `@ledger-hq/domain`; `listObligations` from `./obligations/api`; `getReceivables` from `./billing/api`; `formatLongDate` from `./i18n/format`.
- Produces: the composed Overview page.

This task owns **Review Focus 1**.

`SummaryRow` runs its own two queries with the **same keys** the sections use — `['obligations']` and `['receivables']`. React Query dedupes them into the same two requests, which is what lets the row exist without turning `HomePage` into a data component that prop-drills into both sections.

- [ ] **Step 1: Write the failing test**

`apps/web/src/HomePage.test.tsx` (new file — the page was a bare wrapper and had nothing to assert):

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from './i18n'

const listObligationsMock = vi.hoisted(() => vi.fn())
const patchObligationMock = vi.hoisted(() => vi.fn())
vi.mock('./obligations/api', () => ({
  listObligations: listObligationsMock,
  patchObligation: patchObligationMock,
}))

const getReceivablesMock = vi.hoisted(() => vi.fn())
vi.mock('./billing/api', () => ({ getReceivables: getReceivablesMock }))

const { HomePage } = await import('./HomePage')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage })
  const clientRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/clients/$clientId',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, clientRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    listObligationsMock.mockReset()
    getReceivablesMock.mockReset()
  })

  it('owns the page heading', async () => {
    listObligationsMock.mockResolvedValue([])
    getReceivablesMock.mockResolvedValue([])
    renderHome()

    expect(await screen.findByRole('heading', { level: 1, name: /resumo/i })).toBeInTheDocument()
  })

  // The whole reason the two sections keep separate queries: a slow
  // receivables response must not hold the obligations list back.
  it('renders the obligations list while receivables is still pending', async () => {
    listObligationsMock.mockResolvedValue([
      {
        id: 'o1',
        clientId: 'c1',
        clientName: 'Padaria Central',
        definitionName: 'Pagamento de IVA',
        dueDate: '2026-09-20',
        status: 'PENDING',
      },
    ])
    getReceivablesMock.mockReturnValue(new Promise(() => {}))
    renderHome()

    expect(await screen.findByText(/pagamento de iva/i)).toBeInTheDocument()
  })

  // Review Focus 1. "0 overdue" when nothing could load is worse than
  // saying nothing: it is a wrong answer stated confidently.
  it('renders no summary tiles when both queries fail', async () => {
    listObligationsMock.mockRejectedValue(new Error('offline'))
    getReceivablesMock.mockRejectedValue(new Error('offline'))
    renderHome()

    expect(await screen.findByRole('heading', { level: 1, name: /resumo/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText(/em dívida/i)).not.toBeInTheDocument()
    })
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @ledger-hq/web test -- HomePage
```

Expected: FAIL — there is no `h1`.

- [ ] **Step 3: Write `SummaryRow`**

`apps/web/src/home/SummaryRow.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { groupByUrgency } from '@ledger-hq/domain'
import type { UrgencyGroup } from '@ledger-hq/domain'
import { Card, Money, Skeleton } from '../ui'
import { listObligations } from '../obligations/api'
import { getReceivables } from '../billing/api'

const COUNT_TONE_CLASS: Record<UrgencyGroup, string> = {
  overdue: 'text-danger-700',
  thisWeek: 'text-warning-700',
  thisMonth: 'text-ink',
  later: 'text-ink',
}

// `later` is deliberately absent: a deadline three months out is not news,
// and four tiles of which one is always populated reads as noise.
const TILES: UrgencyGroup[] = ['overdue', 'thisWeek', 'thisMonth']

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-muted">{label}</span>
      {children}
    </Card>
  )
}

export function SummaryRow() {
  const { t } = useTranslation(['common', 'obligations'])

  // Same query keys as the two sections below, so React Query serves all
  // four call sites from two requests.
  const obligations = useQuery({ queryKey: ['obligations'], queryFn: () => listObligations() })
  const receivables = useQuery({ queryKey: ['receivables'], queryFn: getReceivables })

  const groups = obligations.data === undefined ? undefined : groupByUrgency(obligations.data, new Date())
  const populated = groups === undefined ? [] : TILES.filter((key) => groups[key].length > 0)

  // Nothing loaded and nothing loading: say nothing rather than show zeros.
  if (obligations.isError && receivables.isError) return null
  if (!obligations.isPending && populated.length === 0 && receivables.isError) return null

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {obligations.isPending
        ? TILES.map((key) => (
            <Tile key={key} label={t(`obligations:dashboard.${key}`)}>
              <Skeleton width="2.75rem" height="1.75rem" />
            </Tile>
          ))
        : populated.map((key) => (
            <Tile key={key} label={t(`obligations:dashboard.${key}`)}>
              <span className={`text-3xl font-semibold tabular-nums ${COUNT_TONE_CLASS[key]}`}>
                {groups === undefined ? 0 : groups[key].length}
              </span>
            </Tile>
          ))}

      {receivables.isError ? null : (
        <Tile label={t('common:home.outstanding')}>
          {receivables.isPending ? (
            <Skeleton width="8rem" height="1.75rem" />
          ) : (
            <Money cents={receivables.data.reduce((sum, row) => sum + row.outstandingCents, 0)} size="lg" />
          )}
        </Tile>
      )}
    </div>
  )
}
```

The tiles do **not** reuse `URGENCY_TONE`: that map returns badge tones (a tinted background plus a `-700` text shade), and a tile's large number is coloured text on a plain card. Two maps, deliberately, for two different jobs.

- [ ] **Step 4: Rewrite `HomePage`**

`apps/web/src/HomePage.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { PageHeader } from './ui'
import { SummaryRow } from './home/SummaryRow'
import { ObligationsDashboard } from './obligations/ObligationsDashboard'
import { ReceivablesSection } from './billing/ReceivablesSection'
import { formatLongDate } from './i18n/format'
import type { SupportedLocale } from './i18n/format'

export function HomePage() {
  const { t, i18n } = useTranslation('common')
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('home.title')} description={formatLongDate(today, i18n.language as SupportedLocale)} />
      <SummaryRow />
      <ObligationsDashboard />
      <ReceivablesSection />
    </div>
  )
}
```

- [ ] **Step 5: Run everything**

```bash
pnpm --filter @ledger-hq/web test
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/HomePage.tsx apps/web/src/home apps/web/src/HomePage.test.tsx
git commit -m "feat(web): make the home page a real page with a summary row"
```

---

### Task 16: The responsive end-to-end check, and the guidelines document

**Files:**
- Create: `apps/web/e2e/shell.spec.ts`
- Create: `docs/design/guidelines.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code depends on.

The sidebar/tab-bar switch is a CSS media query, which jsdom does not evaluate — it can only be asserted in a real browser.

- [ ] **Step 1: Read how the existing specs sign in**

```bash
sed -n '1,25p' apps/web/e2e/obligations.spec.ts
```

There is no shared helper — each spec inlines the same bootstrap-or-sign-in block, because bootstrap only ever succeeds once per install and a spec has to work either way. Copy that block; do not add a fixture.

- [ ] **Step 2: Write the spec**

`apps/web/e2e/shell.spec.ts`, using whatever sign-in helper Step 1 found:

```ts
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const MASTER_PASSWORD = 'a sufficiently long master password'

// The same bootstrap-or-sign-in block every other spec in this directory
// inlines: bootstrap succeeds only once per install, so the confirm field
// is present on a fresh database and absent on a reused one.
async function signIn(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel(/email/i).fill('paulo@example.com')
  await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
  const confirmPasswordField = page.getByLabel(/confirma/i)
  if (await confirmPasswordField.isVisible().catch(() => false)) {
    await confirmPasswordField.fill(MASTER_PASSWORD)
  }
  await page.getByRole('button', { name: /criar|entrar/i }).click()
}

test.describe('app shell', () => {
  test('navigates from the sidebar on a desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await signIn(page)

    const clients = page.getByRole('link', { name: /clientes/i })
    await expect(clients).toBeVisible()
    await clients.click()
    await expect(page).toHaveURL(/\/clients$/)
  })

  test('navigates from the bottom tab bar on a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)

    // The sidebar is display:none here, so this resolves to the tab bar's
    // icon link, which carries the same label as text on desktop.
    const vaultTab = page.getByRole('link', { name: /cofre/i })
    await expect(vaultTab).toBeVisible()
    await vaultTab.click()
    await expect(page).toHaveURL(/\/vault\/platforms$/)
  })
})
```

- [ ] **Step 3: Run it**

```bash
pnpm --filter @ledger-hq/web test:e2e -- shell
```

Expected: PASS, 2 tests. If the sign-in helper needs a seeded database, follow whatever the existing specs do — do not add a new fixture.

- [ ] **Step 4: Write the guidelines document**

`docs/design/guidelines.md`, from what actually shipped rather than from the spec. It must contain, at minimum:

1. **The token table** — every name in `@theme` with its value and one line on when to use it. Copy it out of `styles.css` so it cannot drift silently.
2. **Which component for which job** — `Badge` vs `Card` vs plain text for status; `Money` vs a raw `formatCurrency` call (the answer is always `Money` in the UI, `formatCurrency` only inside `Money` and in tests); `EmptyState` vs a bare sentence; when a `Skeleton` is worth it (any query whose pending state would otherwise render nothing).
3. **The accessibility checklist**, as the nine numbered items from §9 of the design spec, in checklist form.
4. **The i18n rule** — no hardcoded user-visible string, `aria-label` included; every key in both bundles; `pnpm --filter @ledger-hq/web i18n:check` gates it in CI.
5. **The rule about `ui/`** — no imports from feature folders, ever. Domain mappings like `URGENCY_TONE` and `AGEING_TONE` live with their feature.

- [ ] **Step 5: Run the whole suite one last time**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @ledger-hq/web i18n:check
pnpm --filter @ledger-hq/web test:e2e
```

Expected: all PASS. This is the stage's definition of done.

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e/shell.spec.ts docs/design/guidelines.md
git commit -m "test(web): assert the responsive nav, and document the design system"
```
