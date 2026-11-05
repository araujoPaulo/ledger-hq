# UI refresh, Stage 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the design system its form controls (`Input`, `Textarea`, `Select`, `Checkbox` on one internal `Field`, plus `Button asChild`) and apply them to the client list, a client form that now serves create **and edit**, the sidebar search box and the period-summary dates.

**Architecture:** `ui/Field.tsx` owns label, hint, error and the ids that tie them to a control; `Input`, `Textarea` and `Select` render through it, `Checkbox` stands alone. `Select` and `Checkbox` are native elements, styled — no Radix. `Button` gains `asChild` through `@radix-ui/react-slot` so a router `Link` can wear button styling. `ClientFormPage.tsx` splits into `ClientForm` (state, validation, fields), a thin create page and a new edit page at `/clients/$clientId/edit`, which sends only the fields that changed through the existing `PATCH /clients/:id`.

**Tech Stack:** React 19.2, TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Tailwind CSS v4 (CSS-first tokens in `apps/web/src/styles.css`), TanStack Router and Query, i18next, `class-variance-authority`, `lucide-react`, `@radix-ui/react-slot` (new), Zod 4 (`@ledger-hq/domain`), Vitest + Testing Library (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-ui-refresh-stage-2-design.md` — read it in full before Task 1. The Stage 1 rules it builds on are in `docs/design/guidelines.md`. Screens: <https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92>.

## Global Constraints

- **This API is load-bearing.** Stages 3-5 import `Input`, `Textarea`, `Select`, `Checkbox`, `Button asChild` and the `InputProps` type, and their plans were written against exactly this surface: `label`, `hideLabel?`, `hint?`, `error?`, `leadingIcon?` (Input only), every native prop of the element; `className` lands on the native control, never on a wrapper; `ref` is forwarded to the native control (React 19: `ref` is an ordinary prop, typed through `ComponentProps<'input'>`); a field error renders with `role="alert"`, is linked by `aria-describedby`, and sets `aria-invalid="true"`. Do not rename or reshape any of it. If restyling the client form proves a part wrong, stop and raise it — the spec (§11) says to change it here, but the change has to reach the later plans too.
- **`FieldProps` optional members are typed `| undefined`** (`hint?: string | undefined`), so a caller under `exactOptionalPropertyTypes` can pass `error={map.get('name')}` directly.
- **No API change.** Edit uses the existing `PATCH /clients/:id` and `updateClient` in `apps/web/src/clients/api.ts`.
- **One new route, no changed route:** `/clients/$clientId/edit`.
- **One new dependency:** `@radix-ui/react-slot`. Not `@radix-ui/react-select`, not `@radix-ui/react-checkbox` (spec §2.1).
- **No hardcoded user-visible strings**, `aria-label` included. ESLint's `i18next/no-literal-string` runs with `markupOnly: true` on `src/**/*.tsx` (tests exempt); `pnpm --filter @ledger-hq/web i18n:check` compares the bundles.
- **`pt-PT` copy uses *tu*.** Every existing `clients` string does ("Indica um nome válido.", "Escolhe uma forma jurídica válida."). The spec's §8 table is written that way (spec §2.4). `en-GB` is the spec's, verbatim.
- **Tests assert Portuguese.** Every web test calls `await initI18n()` then `await i18next.changeLanguage('pt-PT')` — jsdom reports `en-US`.
- **Design rules** (`docs/design/guidelines.md`): named exports only; props extend the element's own; `cva` for variants; no component sets a margin on itself; nothing in `ui/` imports from a feature folder; three gaps (`gap-4`, `gap-6`, `gap-8`) between elements — `gap-1.5`/`gap-2` only inside a single control (label to box, icon to text); type scale `text-2xl`/`text-lg`/`text-base`/`text-sm`/`text-xs` only; weight 400 (`font-normal`) for prose only; any column of numbers `tabular-nums`.
- **Tailwind does not resolve two utilities for one property by their order in the class string.** A component never emits two (choose one with a condition, as `Input` does for padding); a caller overriding a component default uses the important modifier (`h-9!`).
- **Commit after every task** with a `feat(web):`, `refactor(web):`, `test(web):` or `docs:` prefix, each message ending with the trailer line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

Five conditions the spec implies but does not test, most likely to bite first. Each has a test in the task that owns the code.

1. **The client refetches in the background while the edit form is open** (window refocus, another tab). Expected: only the fields the user changed are sent — never a stale value overwriting a fresh one because the diff was taken against the new data. The form diffs against the client *as it was loaded*. → Task 10.
2. **A search of only spaces.** The server trims it to nothing, so it is not a filter. Expected: an empty result shows "Ainda não há clientes" with the Create action, not "Nenhum cliente corresponde aos filtros." → Task 8.
3. **Saving the edit form with nothing changed.** Expected: the request is `{ kind }` alone, it succeeds, and the user lands back on the client — not an error, not a request carrying every field. → Task 10.
4. **The server refuses the edit** (`clients.archived` 409 on a direct visit to an archived client's edit URL, or `clients.tax_id_taken`). Expected: the server's message in an alert, the typed values still in the fields, no navigation. → Task 10.
5. **The edit URL names a client that does not exist** (deleted, mistyped). Expected: "Registo não encontrado." — not a skeleton forever, not an empty form. → Task 10.

---

## File Structure

```
apps/web/
  package.json                          Task 3: + @radix-ui/react-slot
  src/
    i18n/locales/{pt,en}/clients.json   Task 2: new keys, `empty` copy change
    ui/
      Button.tsx, Button.test.tsx       Task 3: asChild
      Field.tsx                         Task 4 (new, internal): label, hint, error, ids; controlBox
      Input.tsx, Input.test.tsx         Task 4 (new)
      Textarea.tsx, Textarea.test.tsx   Task 5 (new)
      Select.tsx, Select.test.tsx       Task 5 (new)
      Checkbox.tsx, Checkbox.test.tsx   Task 6 (new)
      index.ts                          Tasks 4-6: exports the four controls and their prop types (not Field)
    search/SearchBox.tsx                Task 7: adopts Input
    reporting/PeriodSummaryReport.tsx   Task 7: adopts Input
    clients/
      kindTone.ts                       Task 8 (new): ClientKind -> BadgeTone
      ClientListSkeleton.tsx            Task 8 (new)
      ClientListPage.tsx, .test.tsx     Task 8: restyled
      ClientForm.tsx                    Task 9 (new): the form, both modes
      ClientFormPage.tsx, .test.tsx     Task 9: create page, now thin
      ClientFormSkeleton.tsx            Task 10 (new): the edit page's pending state
      ClientEditPage.tsx, .test.tsx     Task 10 (new)
      ClientDetailPage.tsx, .test.tsx   Task 11: Edit button; Archive/Restore as Button
    router.tsx                          Task 10: + /clients/$clientId/edit
  e2e/
    setup-and-clients.spec.ts           Task 12: edit journey, phone-width row
    obligations.spec.ts, billing.spec.ts, search-and-reporting.spec.ts, vault-offline.spec.ts
                                        Task 12: the create form's submit is now "Criar"
docs/design/guidelines.md               Task 12: Forms section, checklist additions
docs/design/roadmap.md                  Task 12: Stage 2 shipped
```

`ClientFormSkeleton.tsx` is not in the spec's §7 layout. The spec asks for "a form-shaped skeleton" while the edit page is pending, and the guidelines put every skeleton in a sibling `*Skeleton.tsx`; this is that file.

---

### Task 1: Draw the Stage 2 boards on the canvas

**Files:** none in the repository. The canvas <https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92> is the editable source for every UI refresh screen; it is iterated in place, never replaced, and every screen exists as a desktop (1440×1024) and a mobile (390×844) frame.

**Interfaces:**
- Consumes: spec §3 and §6, the `en-GB` copy of §8 (the boards use English).
- Produces: the visual reference Tasks 7-11 are checked against in Task 12. Once drawn, the boards outrank the spec's prose where they disagree; a disagreement with this plan is raised, not guessed.

- [ ] **Step 1: Read the canvas before touching it**

It can be edited in the browser between sessions, and the Stage 3-5 plans also add boards to it. With the Artifact tool: `read` the artifact (its result carries the Design type's instructions — follow them exactly), `list` with `scope: "files"`, then `read` `project/canvas.json` and every board whose name starts with `Clients` or `NewClient` (the existing Clients and New client boards, desktop and mobile). Note the Clients row's `y` and the rightmost board's `x + w` in that row.

- [ ] **Step 2: Bring the four existing boards in line with the spec's overrides (spec §3)**

Edit copies of the four boards under one scratch folder, at their canvas paths:

- Mobile Clients: remove the "Create" icon from the top bar; the page header holds a full-width primary "Create" button with a plus icon, wrapped below the title.
- New client (both): Company kind shows no *Date of birth* and no *Social security number* at all — not disabled. The footer reads Create (primary), Cancel (ghost) and, right-aligned in small muted text, "The fiscal profile is filled in after the client is created."
- All four: the nav has four items (Deadlines, Clients, Vault, Reports) and the sidebar search box, as shipped — the boards predate Phase 4b.
- Clients (both): the count reads "24 clients"; one archived row shows its name muted and a neutral "Archived" tag after it.

- [ ] **Step 3: Add the new boards**

New files, each with the skeleton the type instructions give (keep the `support.js` head line exactly), real data from the existing boards, and the tokens in `apps/web/src/styles.css`:

| File | Size | Content |
|---|---|---|
| `ClientEdit.dc.html` | 1440×1024 | the New client board as "Edit client": back link "‹ Padaria Central, Lda.", fields pre-filled, *Kind* disabled with the hint "A client's kind cannot change after it is created.", footer Save (primary) + Cancel (ghost), no fiscal-profile hint; one variant of the Email field emptied, showing the error "This field can't be emptied yet. Enter a new value or keep the current one." |
| `ClientEditMobile.dc.html` | 390×844 | the same, one column, footer buttons full width, primary first |
| `ClientsStates.dc.html` | 1440×1024 | three stacked panels of the content area under the real filter bar: loading (six skeleton rows: a name bar and a tag block), no clients (`EmptyState`: users icon, "No clients yet", "Create the first client to start tracking deadlines and fees.", Create button), no matches (search-x icon, "No clients match these filters.", "Try another name, the tax number, or clear the kind filter.", no button) |
| `ClientsStatesMobile.dc.html` | 390×844 | the same three, one column |
| `FormControls.dc.html` | 1440×1024 | the restyled sidebar search box (36px, leading search icon, placeholder) in the shell, and the Reports page's period summary header with the two date inputs (labels "From" / "To" above 40px boxes) and Download |
| `FormControlsMobile.dc.html` | 390×844 | the period summary header at phone width, inputs stacked |

Add each to `canvas.json`'s `boards` (in the Clients row, 80 px apart, continuing right of the last board in that row) and to `order`, keeping every other key as read.

- [ ] **Step 4: Publish once and report**

One Artifact publish call with `url` set to the canvas, `root` the scratch folder, `file_path` the absolute path of `project/canvas.json`, and every changed or new board in `files`. If it is refused because someone saved meanwhile, re-read the named files and redo the edit. Report the canvas link and the list of boards drawn. Do not render, screenshot or re-read to verify.

Nothing to commit.

---

### Task 2: The Stage 2 translation keys

**Files:**
- Modify: `apps/web/src/i18n/locales/pt/clients.json`
- Modify: `apps/web/src/i18n/locales/en/clients.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `clients:editTitle`, `clients:count` (`_one`/`_other`, `{{count}}`), `clients:archived`, `clients:emptyHint`, `clients:noMatches`, `clients:noMatchesHint` (Task 8); `clients:form.section.identification`, `clients:form.section.contact`, `clients:form.kind.immutable`, `clients:form.cannotClear`, `clients:form.profileLater` (Tasks 9-10). `clients:empty` loses its full stop.

- [ ] **Step 1: Replace `pt/clients.json`**

Every existing key keeps its value except `empty`. Full file:

```json
{
  "title": "Clientes",
  "newTitle": "Novo cliente",
  "editTitle": "Editar cliente",
  "empty": "Ainda não há clientes",
  "emptyHint": "Cria o primeiro cliente para começares a acompanhar prazos e avenças.",
  "noMatches": "Nenhum cliente corresponde aos filtros.",
  "noMatchesHint": "Tenta outro nome, o NIF, ou retira o filtro de tipo.",
  "count_one": "{{count}} cliente",
  "count_other": "{{count}} clientes",
  "archived": "Arquivado",
  "filter": { "all": "Todos", "search": "Pesquisar por nome ou NIF", "showArchived": "Mostrar arquivados" },
  "form": {
    "section": { "identification": "Identificação", "contact": "Contacto" },
    "cannotClear": "Este campo ainda não pode ficar vazio. Indica um novo valor ou mantém o atual.",
    "profileLater": "O perfil fiscal preenche-se depois de criar o cliente.",
    "name": { "label": "Nome", "invalid": "Indica um nome válido." },
    "taxId": { "label": "NIF", "invalid": "O NIF não é válido." },
    "kind": { "label": "Tipo", "immutable": "O tipo de cliente não pode ser alterado depois de criado." },
    "legalForm": { "label": "Forma jurídica", "invalid": "Escolhe uma forma jurídica válida." },
    "accounting": { "label": "Contabilidade", "invalid": "Escolhe um tipo de contabilidade válido." },
    "socialSecurityNo": { "label": "NISS", "invalid": "O NISS não é válido." },
    "dateOfBirth": { "label": "Data de nascimento", "invalid": "Indica uma data de nascimento válida." },
    "email": { "label": "Email", "invalid": "Indica um email válido." },
    "phone": { "label": "Telefone", "invalid": "O telefone é demasiado longo." },
    "notes": { "label": "Notas", "invalid": "As notas são demasiado longas." }
  },
  "profile": {
    "title": "Perfil fiscal",
    "hasOpenActivity": "Atividade aberta",
    "vatRegime": "Regime de IVA",
    "incomeTax": "Imposto sobre o rendimento",
    "hasEmployees": "Tem empregados",
    "hasWithholding": "Faz retenções na fonte",
    "isVatCashBasis": "IVA de caixa",
    "startedAt": "Início"
  }
}
```

- [ ] **Step 2: Replace `en/clients.json`**

```json
{
  "title": "Clients",
  "newTitle": "New client",
  "editTitle": "Edit client",
  "empty": "No clients yet",
  "emptyHint": "Create the first client to start tracking deadlines and fees.",
  "noMatches": "No clients match these filters.",
  "noMatchesHint": "Try another name, the tax number, or clear the kind filter.",
  "count_one": "{{count}} client",
  "count_other": "{{count}} clients",
  "archived": "Archived",
  "filter": { "all": "All", "search": "Search by name or tax number", "showArchived": "Show archived" },
  "form": {
    "section": { "identification": "Identification", "contact": "Contact" },
    "cannotClear": "This field can't be emptied yet. Enter a new value or keep the current one.",
    "profileLater": "The fiscal profile is filled in after the client is created.",
    "name": { "label": "Name", "invalid": "Enter a valid name." },
    "taxId": { "label": "Tax number", "invalid": "This tax number is not valid." },
    "kind": { "label": "Kind", "immutable": "A client's kind cannot change after it is created." },
    "legalForm": { "label": "Legal form", "invalid": "Choose a valid legal form." },
    "accounting": { "label": "Accounting", "invalid": "Choose a valid accounting type." },
    "socialSecurityNo": { "label": "Social security number", "invalid": "This social security number is not valid." },
    "dateOfBirth": { "label": "Date of birth", "invalid": "Enter a valid date of birth." },
    "email": { "label": "Email", "invalid": "Enter a valid email address." },
    "phone": { "label": "Phone", "invalid": "The phone number is too long." },
    "notes": { "label": "Notes", "invalid": "The notes are too long." }
  },
  "profile": {
    "title": "Fiscal profile",
    "hasOpenActivity": "Open activity",
    "vatRegime": "VAT regime",
    "incomeTax": "Income tax",
    "hasEmployees": "Has employees",
    "hasWithholding": "Withholds tax at source",
    "isVatCashBasis": "VAT cash basis",
    "startedAt": "Start date"
  }
}
```

- [ ] **Step 3: Verify the bundles agree, plurals included, and nothing broke**

```bash
cd /Users/pauloaraujo/Projects/personal/ledger-hq
pnpm --filter @ledger-hq/web i18n:check
pnpm --filter @ledger-hq/web test -- locales ClientListPage
```

Expected: `i18n:check` prints `Locale bundles agree on N keys.` with 12 more keys than before (`count_one` and `count_other` are two plain keys to the checker, present in both bundles — that is the confirmation spec §8 asks for). `locales.test.ts` PASS. The existing `ClientListPage` tests PASS (the empty-state test matches `/ainda não há clientes/i`, with or without the full stop).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/i18n/locales
git commit -m "feat(web): add the Stage 2 translation keys" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `Button asChild`

**Files:**
- Modify: `apps/web/package.json` (via `pnpm add`)
- Modify: `apps/web/src/ui/Button.tsx`
- Test: `apps/web/src/ui/Button.test.tsx`

**Interfaces:**
- Consumes: `Slot` from `@radix-ui/react-slot`.
- Produces: `Button` with `asChild?: boolean`. With `asChild`, the single child element (a `Link` or `<a>`) is rendered with the button's classes and the remaining props; `type`, `disabled` and `isLoading` are compile errors in that mode. Without it, behaviour is unchanged. Used by Tasks 8-11, and by Stages 3-5.

- [ ] **Step 1: Install the dependency and check its React peer range**

```bash
cd /Users/pauloaraujo/Projects/personal/ledger-hq
pnpm --filter @ledger-hq/web add @radix-ui/react-slot@^1.3.3
grep -A3 '"peerDependencies"' apps/web/node_modules/@radix-ui/react-slot/package.json
```

Expected: the `react` peer range includes `^19.0`. (1.3.3 is already in the lockfile as a transitive dependency of the dropdown menu, so the install adds no new package.) If the range does not include React 19, stop: the spec's fallback (a `buttonClasses()` export applied to a `Link` directly) changes the API Stages 3-5 consume, and is a decision for the human partner.

- [ ] **Step 2: Write the failing tests**

Append inside `describe('Button', …)` in `apps/web/src/ui/Button.test.tsx`:

```tsx
  // Spec §5.6: a router Link that looks like a button, without nesting a
  // <button> inside an <a> (invalid, and two tab stops).
  it('renders its child link with the button classes under asChild', () => {
    render(
      <Button asChild variant="primary">
        <a href="/clients/new">Criar</a>
      </Button>,
    )

    const link = screen.getByRole('link', { name: 'Criar' })
    expect(link).toHaveAttribute('href', '/clients/new')
    expect(link).toHaveClass('bg-accent-600')
    expect(link).not.toHaveAttribute('type')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('will not compile asChild with a type, a loading state or disabled', () => {
    // @ts-expect-error type="button" on an anchor is invalid
    render(<Button asChild type="button"><a href="/">Um</a></Button>)
    // @ts-expect-error a link does not load
    render(<Button asChild isLoading><a href="/">Dois</a></Button>)
    // @ts-expect-error a link that cannot be followed should not be rendered
    render(<Button asChild disabled><a href="/">Três</a></Button>)
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })
```

- [ ] **Step 3: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- Button
pnpm --filter @ledger-hq/web typecheck
```

Expected: the first test FAILS (a `<button>` wraps the anchor, so `queryByRole('button')` finds it); `typecheck` FAILS on `asChild` not existing on `ButtonProps` and on the three unused `@ts-expect-error` directives.

- [ ] **Step 4: Implement `asChild` in `Button.tsx`**

Replace everything from `type ButtonBaseProps` to the end of the file (the `button` cva above it is unchanged) with:

```tsx
type ButtonOwnProps = Omit<ComponentPropsWithoutRef<'button'>, 'type' | 'disabled'> & {
  variant?: NonNullable<VariantProps<typeof button>['variant']>
}

/**
 * `size="icon"` narrows the props to require an accessible name. An icon-only
 * button has no text for a screen reader to fall back on, and the type is the
 * only thing that catches the omission before it ships.
 */
type SizeProps = { size?: 'sm' | 'md' } | { size: 'icon'; 'aria-label': string }

/**
 * `asChild` renders the single child — a router `Link` — with the button's
 * classes instead of a `<button>`. An anchor has no `type`, a link does not
 * load, and a link that cannot be followed should not be rendered at all, so
 * the type forbids all three in that mode.
 */
type ModeProps =
  | {
      asChild?: false | undefined
      type?: 'button' | 'submit' | 'reset' | undefined
      disabled?: boolean | undefined
      isLoading?: boolean | undefined
    }
  | { asChild: true; type?: never; disabled?: never; isLoading?: never }

type ButtonProps = ButtonOwnProps & SizeProps & ModeProps

export function Button({
  variant,
  size,
  asChild = false,
  isLoading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = `${button({ variant, size })}${className === undefined ? '' : ` ${className}`}`

  if (asChild) {
    return (
      <Slot {...rest} className={classes}>
        {children}
      </Slot>
    )
  }

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled === true || isLoading}
      aria-busy={isLoading || undefined}
      className={classes}
    >
      {isLoading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}
```

and add to the imports at the top:

```tsx
import { Slot } from '@radix-ui/react-slot'
```

- [ ] **Step 5: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- Button
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: all PASS — the six `Button` tests, and no type error anywhere in `src` (every existing `<Button>` call site still fits the `asChild?: false` branch; its members admit `undefined` because the native props they replace did, so a call site passing `disabled={maybe}` still compiles).

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/ui/Button.tsx apps/web/src/ui/Button.test.tsx
git commit -m "feat(web): let Button render a link with asChild" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `Field` and `Input`

**Files:**
- Create: `apps/web/src/ui/Field.tsx`
- Create: `apps/web/src/ui/Input.tsx`
- Test: `apps/web/src/ui/Input.test.tsx`
- Modify: `apps/web/src/ui/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Field.tsx` (internal — never exported from `ui/index.ts`): `type FieldProps = { label: string; hideLabel?: boolean | undefined; hint?: string | undefined; error?: string | undefined }`; `type FieldControlProps = { id: string; 'aria-describedby': string | undefined; 'aria-invalid': true | undefined }`; `controlBox` (a `cva` with variant `invalid: boolean` — border, surface, focus ring, disabled treatment; **no** width, height or padding); `Field(props: FieldProps & { id: string | undefined; describedBy: string | undefined; layout?: 'stacked' | 'inline'; children: (control: FieldControlProps) => ReactNode })`.
  - `Input.tsx`: `export type InputProps = ComponentProps<'input'> & FieldProps & { leadingIcon?: LucideIcon | undefined }`; `export function Input(props: InputProps)`. `className` and `ref` land on the `<input>`.
  - `ui/index.ts` exports `Input` and `type InputProps` (Stage 3's `MoneyInput` is `Omit<InputProps, …>`).

- [ ] **Step 1: Write the failing test**

`apps/web/src/ui/Input.test.tsx`:

```tsx
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Search } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { Input } from './Input'

describe('Input', () => {
  it('is named by its visible label, and the label focuses it', async () => {
    render(<Input label="Nome" />)

    const input = screen.getByRole('textbox', { name: 'Nome' })
    await userEvent.click(screen.getByText('Nome'))
    expect(input).toHaveFocus()
  })

  // Spec §9.1: a placeholder is never the label. A hidden label still is.
  it('keeps the accessible name when the label is visually hidden', () => {
    render(<Input type="search" label="Pesquisar" hideLabel placeholder="Nome ou NIF" />)

    expect(screen.getByRole('searchbox', { name: 'Pesquisar' })).toBeInTheDocument()
    expect(screen.getByText('Pesquisar')).toHaveClass('sr-only')
  })

  it('is described by its hint, then its error, in that order', () => {
    render(<Input label="NIF" hint="Nove dígitos" error="O NIF não é válido." />)

    expect(screen.getByRole('textbox', { name: 'NIF' })).toHaveAccessibleDescription(
      'Nove dígitos O NIF não é válido.',
    )
  })

  // Spec §9.2: announced, linked, marked — never colour alone.
  it('marks an error invalid and announces it', () => {
    render(<Input label="NIF" error="O NIF não é válido." />)

    expect(screen.getByRole('textbox', { name: 'NIF' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('O NIF não é válido.')
  })

  it('is neither invalid nor described without a hint or an error', () => {
    render(<Input label="Nome" />)

    const input = screen.getByRole('textbox', { name: 'Nome' })
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("appends the caller's own aria-describedby rather than replacing it", () => {
    render(
      <>
        <p id="external">Usado nas faturas</p>
        <Input label="NIF" hint="Nove dígitos" aria-describedby="external" />
      </>,
    )

    expect(screen.getByRole('textbox', { name: 'NIF' })).toHaveAccessibleDescription(
      'Nove dígitos Usado nas faturas',
    )
  })

  // Spec §11: the search box's "/" shortcut focuses through this ref. A ref
  // that lands on a wrapper silently breaks it.
  it('forwards its ref to the input element', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Input label="Nome" ref={ref} />)

    expect(ref.current).toBe(screen.getByRole('textbox', { name: 'Nome' }))
  })

  it('puts className on the input, not on a wrapper', () => {
    render(<Input label="Nome" className="h-9!" />)

    expect(screen.getByRole('textbox', { name: 'Nome' })).toHaveClass('h-9!')
  })

  it('draws a leading icon hidden from assistive technology and pads past it', () => {
    const { container } = render(<Input type="search" label="Pesquisar" leadingIcon={Search} />)

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('searchbox', { name: 'Pesquisar' })).toHaveClass('pl-9')
  })

  it('uses tabular figures for numeric input', () => {
    render(<Input label="NIF" inputMode="numeric" />)

    expect(screen.getByRole('textbox', { name: 'NIF' })).toHaveClass('tabular-nums')
  })

  it('passes native props through, including type and disabled', () => {
    render(<Input label="Desde" type="date" disabled defaultValue="2026-01-01" />)

    const input = screen.getByLabelText('Desde')
    expect(input).toHaveAttribute('type', 'date')
    expect(input).toBeDisabled()
    expect(input).toHaveValue('2026-01-01')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- Input
```

Expected: FAIL — `Failed to resolve import "./Input"`.

- [ ] **Step 3: Write `Field.tsx`**

```tsx
import { useId } from 'react'
import type { ReactNode } from 'react'
import { cva } from 'class-variance-authority'
import { CircleAlert } from 'lucide-react'

/**
 * What every labelled control takes. Optional members admit `undefined`
 * explicitly, so a caller can pass `error={errors.get('name')}` under
 * `exactOptionalPropertyTypes`.
 */
export type FieldProps = {
  label: string
  /** Visually hidden, still the accessible name. A placeholder is never the label. */
  hideLabel?: boolean | undefined
  hint?: string | undefined
  error?: string | undefined
}

/** The ids `Field` hands its control, which tie label, hint and error to it. */
export type FieldControlProps = {
  id: string
  'aria-describedby': string | undefined
  'aria-invalid': true | undefined
}

/**
 * The box every text-like control shares: border, surface, focus ring and
 * the disabled treatment. Width, height and padding are each control's own,
 * so no control ever carries two utilities for one property.
 */
export const controlBox = cva(
  'rounded-surface border bg-surface text-sm text-ink placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 disabled:cursor-not-allowed disabled:border-line disabled:bg-ground disabled:text-subtle',
  {
    variants: { invalid: { true: 'border-danger-700', false: 'border-line-strong' } },
    defaultVariants: { invalid: false },
  },
)

type FieldRootProps = FieldProps & {
  /** The caller's own id, if any; otherwise one is generated. */
  id: string | undefined
  /** The caller's own aria-describedby, appended after the hint and the error. */
  describedBy: string | undefined
  layout?: 'stacked' | 'inline'
  children: (control: FieldControlProps) => ReactNode
}

/**
 * Label, hint and error for one control, so they behave identically on every
 * form. Internal to `ui/` — callers use `Input`, `Textarea` and `Select`.
 */
export function Field({
  label,
  hideLabel = false,
  hint,
  error,
  id,
  describedBy,
  layout = 'stacked',
  children,
}: FieldRootProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  const hintId = `${controlId}-hint`
  const errorId = `${controlId}-error`

  const describedByIds = [
    hint !== undefined ? hintId : null,
    error !== undefined ? errorId : null,
    describedBy ?? null,
  ]
    .filter((value): value is string => value !== null && value !== '')
    .join(' ')

  const control = children({
    id: controlId,
    'aria-describedby': describedByIds === '' ? undefined : describedByIds,
    'aria-invalid': error !== undefined ? true : undefined,
  })

  const labelClass = hideLabel
    ? 'sr-only'
    : `text-sm font-medium text-muted${layout === 'inline' ? ' whitespace-nowrap' : ''}`
  const labelElement = (
    <label htmlFor={controlId} className={labelClass}>
      {label}
    </label>
  )

  if (layout === 'inline') {
    return (
      <div className="flex items-center gap-2">
        {labelElement}
        {control}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {labelElement}
      {control}
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error !== undefined && (
        // The role existing field errors already carry: announced when it appears.
        <p id={errorId} role="alert" className="flex items-center gap-1.5 text-xs font-medium text-danger-700">
          <CircleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Write `Input.tsx`**

```tsx
import type { ComponentProps } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Field, controlBox } from './Field'
import type { FieldProps } from './Field'

export type InputProps = ComponentProps<'input'> &
  FieldProps & {
    /** A 16px icon inside the left edge — search boxes. */
    leadingIcon?: LucideIcon | undefined
  }

/**
 * A labelled text input. `className` and `ref` land on the `<input>` — the
 * search box's `/` shortcut focuses through the ref. To override the 40px
 * height, use Tailwind's important modifier (`h-9!`).
 */
export function Input({
  label,
  hideLabel,
  hint,
  error,
  leadingIcon: Icon,
  id,
  'aria-describedby': describedBy,
  inputMode,
  className,
  ...rest
}: InputProps) {
  return (
    <Field label={label} hideLabel={hideLabel} hint={hint} error={error} id={id} describedBy={describedBy}>
      {(control) => {
        const input = (
          <input
            {...rest}
            {...control}
            inputMode={inputMode}
            className={[
              controlBox({ invalid: error !== undefined }),
              'h-10 w-full',
              Icon === undefined ? 'px-3' : 'pl-9 pr-3',
              inputMode === 'numeric' ? 'tabular-nums' : null,
              className ?? null,
            ]
              .filter((value) => value !== null)
              .join(' ')}
          />
        )

        if (Icon === undefined) return input

        return (
          <div className="relative">
            <Icon
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            />
            {input}
          </div>
        )
      }}
    </Field>
  )
}
```

- [ ] **Step 5: Export it**

In `apps/web/src/ui/index.ts`, after the `EmptyState` line:

```ts
export { Input } from './Input'
export type { InputProps } from './Input'
```

- [ ] **Step 6: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- Input
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 11 `Input` tests PASS; no type or lint error.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/ui/Field.tsx apps/web/src/ui/Input.tsx apps/web/src/ui/Input.test.tsx apps/web/src/ui/index.ts
git commit -m "feat(web): add the Input control on a shared Field" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `Textarea` and `Select`

**Files:**
- Create: `apps/web/src/ui/Textarea.tsx`, `apps/web/src/ui/Select.tsx`
- Test: `apps/web/src/ui/Textarea.test.tsx`, `apps/web/src/ui/Select.test.tsx`
- Modify: `apps/web/src/ui/index.ts`

**Interfaces:**
- Consumes: `Field`, `FieldProps`, `controlBox` from `./Field` (Task 4).
- Produces:
  - `export type TextareaProps = ComponentProps<'textarea'> & FieldProps`; `Textarea`.
  - `export type SelectProps = ComponentProps<'select'> & Pick<FieldProps, 'label' | 'hideLabel'> & ({ layout?: 'stacked'; hint?: string | undefined; error?: string | undefined } | { layout: 'inline'; hint?: never; error?: never })`; `Select`. Options are `<option>` children.
  - Both exported, with their prop types, from `ui/index.ts`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/ui/Textarea.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Textarea } from './Textarea'

describe('Textarea', () => {
  it('is named by its label', () => {
    render(<Textarea label="Notas" />)

    expect(screen.getByRole('textbox', { name: 'Notas' }).tagName).toBe('TEXTAREA')
  })

  it('marks, links and announces an error, as Input does', () => {
    render(<Textarea label="Notas" error="As notas são demasiado longas." />)

    const textarea = screen.getByRole('textbox', { name: 'Notas' })
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    expect(textarea).toHaveAccessibleDescription('As notas são demasiado longas.')
    expect(screen.getByRole('alert')).toHaveTextContent('As notas são demasiado longas.')
  })

  // Stage 1's rule for weight 400: it holds prose.
  it('sets prose in the regular weight and resizes vertically only', () => {
    render(<Textarea label="Notas" />)

    expect(screen.getByRole('textbox', { name: 'Notas' })).toHaveClass('font-normal', 'resize-y')
  })
})
```

`apps/web/src/ui/Select.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Select } from './Select'

function KindOptions() {
  return (
    <>
      <option value="COMPANY">Empresa</option>
      <option value="INDIVIDUAL">Pessoa singular</option>
    </>
  )
}

describe('Select', () => {
  it('renders its option children as a native select named by its label', async () => {
    render(
      <Select label="Tipo" defaultValue="COMPANY">
        <KindOptions />
      </Select>,
    )

    const select = screen.getByRole('combobox', { name: 'Tipo' })
    expect(select.tagName).toBe('SELECT')
    expect(screen.getAllByRole('option')).toHaveLength(2)

    await userEvent.selectOptions(select, 'INDIVIDUAL')
    expect(select).toHaveValue('INDIVIDUAL')
  })

  it('keeps the label association with the label beside it (inline)', () => {
    render(
      <Select layout="inline" label="Tipo">
        <KindOptions />
      </Select>,
    )

    expect(screen.getByRole('combobox', { name: 'Tipo' })).toBeInTheDocument()
  })

  it('marks, links and announces an error, as Input does', () => {
    render(
      <Select label="Forma jurídica" error="Escolhe uma forma jurídica válida.">
        <KindOptions />
      </Select>,
    )

    const select = screen.getByRole('combobox', { name: 'Forma jurídica' })
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveAccessibleDescription('Escolhe uma forma jurídica válida.')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  // The edit form's kind: disabled because it cannot change, and the hint says so.
  it('can be disabled with a hint that explains why', () => {
    render(
      <Select label="Tipo" disabled hint="O tipo de cliente não pode ser alterado depois de criado.">
        <KindOptions />
      </Select>,
    )

    const select = screen.getByRole('combobox', { name: 'Tipo' })
    expect(select).toBeDisabled()
    expect(select).toHaveAccessibleDescription('O tipo de cliente não pode ser alterado depois de criado.')
  })

  // Spec §5.4: a filter has neither a hint nor an error.
  it('will not compile an inline select with a hint or an error', () => {
    // @ts-expect-error inline selects take no error
    render(<Select layout="inline" label="A" error="x"><KindOptions /></Select>)
    // @ts-expect-error inline selects take no hint
    render(<Select layout="inline" label="B" hint="x"><KindOptions /></Select>)
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- Textarea Select
```

Expected: FAIL — `Failed to resolve import "./Textarea"` and `"./Select"`.

- [ ] **Step 3: Write `Textarea.tsx`**

```tsx
import type { ComponentProps } from 'react'
import { Field, controlBox } from './Field'
import type { FieldProps } from './Field'

export type TextareaProps = ComponentProps<'textarea'> & FieldProps

/** The `Input` treatment for prose: regular weight, grows downwards only. */
export function Textarea({
  label,
  hideLabel,
  hint,
  error,
  id,
  'aria-describedby': describedBy,
  className,
  ...rest
}: TextareaProps) {
  return (
    <Field label={label} hideLabel={hideLabel} hint={hint} error={error} id={id} describedBy={describedBy}>
      {(control) => (
        <textarea
          {...rest}
          {...control}
          className={[
            controlBox({ invalid: error !== undefined }),
            'min-h-24 w-full resize-y px-3 py-2.5 font-normal',
            className ?? null,
          ]
            .filter((value) => value !== null)
            .join(' ')}
        />
      )}
    </Field>
  )
}
```

- [ ] **Step 4: Write `Select.tsx`**

```tsx
import type { ComponentProps } from 'react'
import { ChevronDown } from 'lucide-react'
import { Field, controlBox } from './Field'
import type { FieldProps } from './Field'

/**
 * `layout="inline"` puts the label beside the control — filter bars only. A
 * filter has neither a hint nor an error, so the type forbids both there.
 */
type LayoutProps =
  | { layout?: 'stacked'; hint?: string | undefined; error?: string | undefined }
  | { layout: 'inline'; hint?: never; error?: never }

export type SelectProps = ComponentProps<'select'> & Pick<FieldProps, 'label' | 'hideLabel'> & LayoutProps

/**
 * A native `<select>`, styled (spec §2.1): the phone's own picker, real form
 * participation, and `userEvent.selectOptions` in tests. Options are
 * `<option>` children, built at the call site from a `*_VALUES` constant.
 */
export function Select({
  label,
  hideLabel,
  hint,
  error,
  layout = 'stacked',
  id,
  'aria-describedby': describedBy,
  className,
  children,
  ...rest
}: SelectProps) {
  return (
    <Field
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error}
      id={id}
      describedBy={describedBy}
      layout={layout}
    >
      {(control) => (
        <div className="relative">
          <select
            {...rest}
            {...control}
            className={[
              controlBox({ invalid: error !== undefined }),
              'h-10 appearance-none pl-3 pr-9',
              layout === 'stacked' ? 'w-full' : null,
              className ?? null,
            ]
              .filter((value) => value !== null)
              .join(' ')}
          >
            {children}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
          />
        </div>
      )}
    </Field>
  )
}
```

- [ ] **Step 5: Export them**

In `apps/web/src/ui/index.ts`, keeping alphabetical order: after `PageHeader`, add

```ts
export { Select } from './Select'
export type { SelectProps } from './Select'
```

and after `Skeleton`, add

```ts
export { Textarea } from './Textarea'
export type { TextareaProps } from './Textarea'
```

- [ ] **Step 6: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- Textarea Select
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 3 `Textarea` and 5 `Select` tests PASS; no type or lint error (both `@ts-expect-error` directives are used).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/ui/Textarea.tsx apps/web/src/ui/Textarea.test.tsx apps/web/src/ui/Select.tsx apps/web/src/ui/Select.test.tsx apps/web/src/ui/index.ts
git commit -m "feat(web): add the Textarea and native Select controls" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `Checkbox`

**Files:**
- Create: `apps/web/src/ui/Checkbox.tsx`
- Test: `apps/web/src/ui/Checkbox.test.tsx`
- Modify: `apps/web/src/ui/index.ts`

**Interfaces:**
- Consumes: nothing (Checkbox does not use `Field` — spec §5.5).
- Produces: `export type CheckboxProps = Omit<ComponentProps<'input'>, 'type'> & { label: string; description?: string | undefined; boxed?: boolean | undefined }`; `Checkbox`. The accessible name is the label alone; `description` is the accessible description; `className` and `ref` land on the `<input>`. Exported with its prop type from `ui/index.ts`. Used by Task 8 (`boxed`) and by Stages 3-4.

- [ ] **Step 1: Write the failing test**

`apps/web/src/ui/Checkbox.test.tsx`:

```tsx
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
  it('toggles when its label text is clicked', async () => {
    render(<Checkbox label="Mostrar arquivados" />)

    const checkbox = screen.getByRole('checkbox', { name: 'Mostrar arquivados' })
    await userEvent.click(screen.getByText('Mostrar arquivados'))
    expect(checkbox).toBeChecked()
  })

  // The name stays the label alone; the description is the description.
  it('is described by its description, which is not part of its name', () => {
    render(<Checkbox label="Tem empregados" description="Ativa a obrigação da DMR mensal." />)

    const checkbox = screen.getByRole('checkbox', { name: 'Tem empregados' })
    expect(checkbox).toHaveAccessibleDescription('Ativa a obrigação da DMR mensal.')
  })

  // Spec §9.4: in the filter bar the whole 40px box is the touch target.
  it('draws the boxed variant as one 40px clickable box', async () => {
    render(<Checkbox boxed label="Mostrar arquivados" />)

    const box = screen.getByText('Mostrar arquivados').closest('label')
    expect(box).toHaveClass('h-10')
    await userEvent.click(box as HTMLElement)
    expect(screen.getByRole('checkbox', { name: 'Mostrar arquivados' })).toBeChecked()
  })

  it('passes native props and its ref to the input', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Checkbox label="Atividade aberta" ref={ref} disabled defaultChecked />)

    const checkbox = screen.getByRole('checkbox', { name: 'Atividade aberta' })
    expect(ref.current).toBe(checkbox)
    expect(checkbox).toBeDisabled()
    expect(checkbox).toBeChecked()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- Checkbox
```

Expected: FAIL — `Failed to resolve import "./Checkbox"`.

- [ ] **Step 3: Write `Checkbox.tsx`**

```tsx
import { useId } from 'react'
import type { ComponentProps } from 'react'

export type CheckboxProps = Omit<ComponentProps<'input'>, 'type'> & {
  label: string
  description?: string | undefined
  /** A 40px bordered box, level with `Input` and `Select` in a filter bar. */
  boxed?: boolean | undefined
}

const labelBase =
  'flex cursor-pointer items-center gap-2 text-sm font-medium has-disabled:cursor-not-allowed has-disabled:text-subtle'

/**
 * A native checkbox in the accent colour, label to its right. The label wraps
 * the input, so the whole label is the click target. The description sits
 * outside it so it never becomes part of the accessible name.
 */
export function Checkbox({
  label,
  description,
  boxed = false,
  id,
  'aria-describedby': describedBy,
  className,
  ...rest
}: CheckboxProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const descriptionId = `${inputId}-description`
  const describedByIds = [description !== undefined ? descriptionId : null, describedBy ?? null]
    .filter((value): value is string => value !== null && value !== '')
    .join(' ')

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={inputId}
        className={
          boxed ? `${labelBase} h-10 rounded-surface border border-line-strong bg-surface px-3` : labelBase
        }
      >
        <input
          {...rest}
          id={inputId}
          type="checkbox"
          aria-describedby={describedByIds === '' ? undefined : describedByIds}
          className={`h-4 w-4 shrink-0 accent-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed${className === undefined ? '' : ` ${className}`}`}
        />
        {label}
      </label>
      {description !== undefined && (
        <p id={descriptionId} className="pl-6 text-xs font-normal text-muted">
          {description}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Export it**

In `apps/web/src/ui/index.ts`, after the `Card` line:

```ts
export { Checkbox } from './Checkbox'
export type { CheckboxProps } from './Checkbox'
```

- [ ] **Step 5: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- Checkbox
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 4 `Checkbox` tests PASS; no type or lint error.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/Checkbox.tsx apps/web/src/ui/Checkbox.test.tsx apps/web/src/ui/index.ts
git commit -m "feat(web): add the native Checkbox control" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The search box and the period-summary dates adopt `Input`

**Files:**
- Modify: `apps/web/src/search/SearchBox.tsx`
- Modify: `apps/web/src/reporting/PeriodSummaryReport.tsx`
- Tests (unchanged, must pass): `apps/web/src/search/SearchBox.test.tsx`, `apps/web/src/reporting/PeriodSummaryReport.test.tsx`

**Interfaces:**
- Consumes: `Input` from `../ui` (Task 4).
- Produces: nothing later tasks import.

Both test files already query by role and label. They are the test for this task: they must pass **without modification**. A failure is a semantic regression in `Input` or here — fix the code, never the test (spec §10).

- [ ] **Step 1: Restyle `SearchBox.tsx`**

Replace the doc comment above `export function SearchBox()` with:

```tsx
/** The shell's only text input, so it owns the `/` shortcut. */
```

Replace the returned JSX (from `return (` to the end of the component) with:

```tsx
  return (
    <div className="px-2">
      <Input
        ref={inputRef}
        type="search"
        leadingIcon={Search}
        hideLabel
        label={t('search.label')}
        placeholder={t('search.placeholder')}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          setValue('')
          event.currentTarget.blur()
        }}
        // 36px to sit in the sidebar; `!` because Input's own height is h-10.
        className="h-9!"
      />
    </div>
  )
```

Add `import { Input } from '../ui'` to the imports. Everything else — the `/` handler, the debounce, `replace: true` — is unchanged.

- [ ] **Step 2: Restyle the date range in `PeriodSummaryReport.tsx`**

Replace the `<div className="flex flex-wrap items-end gap-3">` block (the two `<label>`s and the download button) with:

```tsx
        <div className="flex flex-wrap items-end gap-4">
          <Input
            type="date"
            label={t('periodSummary.from')}
            value={window.from}
            max={window.to}
            onChange={(event) => setWindow((current) => ({ ...current, from: event.target.value }))}
          />
          <Input
            type="date"
            label={t('periodSummary.to')}
            value={window.to}
            min={window.from}
            onChange={(event) => setWindow((current) => ({ ...current, to: event.target.value }))}
          />
          {summary.data !== undefined && (
            <Button variant="secondary" onClick={download}>
              {t('download')}
            </Button>
          )}
        </div>
```

Change the `../ui` import to `import { Button, Card, DataList, Input, Money } from '../ui'`. The inverted-range `role="status"` paragraph stays as it is: it describes the pair, not either field (spec §6.6).

- [ ] **Step 3: Run both suites unchanged, plus the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- SearchBox PeriodSummaryReport
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: PASS — in particular `focuses the box when "/" is pressed outside a text field` (the ref reaches the `<input>`) and the inverted-range test (`getByLabelText('Até')` still finds the "to" date).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/search/SearchBox.tsx apps/web/src/reporting/PeriodSummaryReport.tsx
git commit -m "refactor(web): build the search box and report dates on Input" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The client list

**Files:**
- Create: `apps/web/src/clients/kindTone.ts`
- Create: `apps/web/src/clients/ClientListSkeleton.tsx`
- Modify: `apps/web/src/clients/ClientListPage.tsx`
- Test: `apps/web/src/clients/ClientListPage.test.tsx`

**Interfaces:**
- Consumes: `Badge`, `Button` (asChild), `Card`, `Checkbox`, `DataList`, `EmptyState`, `Input`, `PageHeader`, `Select`, `Skeleton`, `BadgeTone` from `../ui`; the Task 2 keys.
- Produces: `export const KIND_TONE: Record<ClientKind, BadgeTone>`; `export function ClientListSkeleton()`. `ClientListPage` keeps its export and its query key `['clients', filters]`.

- [ ] **Step 1: Replace the test file with the new expectations**

`apps/web/src/clients/ClientListPage.test.tsx` — keep the header (imports, mock, `initI18n`, `changeLanguage`, `company`, `person`, `renderPage` and its comment) exactly as it is, then replace the whole `describe` block with:

```tsx
describe('ClientListPage', () => {
  it('lists clients with their tax number and a kind badge', async () => {
    listClients.mockResolvedValue([company, person])
    renderPage()

    expect(await screen.findByRole('link', { name: 'Padaria Central, Lda.' })).toHaveAttribute('href', '/clients/1')
    expect(screen.getByRole('link', { name: 'Maria Santos' })).toHaveAttribute('href', '/clients/2')
    // Spans only: the kind filter's <option>s carry the same two words.
    expect(screen.getAllByText(/^(Empresa|Pessoa singular)$/, { selector: 'span' })).toHaveLength(2)
    // Twice per row: the mobile caption and the desktop column (CSS picks one).
    expect(screen.getAllByText('501442600')).toHaveLength(2)
  })

  it('counts the results with the right plural', async () => {
    listClients.mockResolvedValue([company, person])
    const { unmount } = renderPage()
    expect(await screen.findByText('2 clientes')).toBeInTheDocument()
    unmount()

    listClients.mockResolvedValue([company])
    renderPage()
    expect(await screen.findByText('1 cliente')).toBeInTheDocument()
  })

  it('shows a skeleton and the real filter bar while the first load is pending, and no count', async () => {
    listClients.mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()

    expect(await screen.findByRole('searchbox', { name: /pesquisar por nome ou nif/i })).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByText(/^\d+ clientes?$/)).not.toBeInTheDocument()
  })

  it('offers to create the first client when there are none', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    expect(await screen.findByText('Ainda não há clientes')).toBeInTheDocument()
    expect(screen.getByText(/cria o primeiro cliente/i)).toBeInTheDocument()
    // The header's Create and the empty state's own.
    expect(screen.getAllByRole('link', { name: /criar/i })).toHaveLength(2)
  })

  it('says the filters match nothing, without a Create action, when a search finds nothing', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    await userEvent.type(await screen.findByRole('searchbox'), 'zzz')

    expect(await screen.findByText('Nenhum cliente corresponde aos filtros.')).toBeInTheDocument()
    expect(screen.queryByText('Ainda não há clientes')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /criar/i })).toHaveLength(1)
  })

  it('treats a kind filter that matches nothing as filtered', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    await userEvent.selectOptions(await screen.findByLabelText(/^tipo$/i), 'COMPANY')

    expect(await screen.findByText('Nenhum cliente corresponde aos filtros.')).toBeInTheDocument()
  })

  // Review Focus 2: the server trims the search to nothing, so it is no filter.
  it('treats a search of only spaces as no search at all', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    await userEvent.type(await screen.findByRole('searchbox'), '   ')
    await vi.waitFor(() => {
      expect(listClients).toHaveBeenLastCalledWith(expect.objectContaining({ search: '   ' }))
    })

    expect(await screen.findByText('Ainda não há clientes')).toBeInTheDocument()
    expect(screen.queryByText('Nenhum cliente corresponde aos filtros.')).not.toBeInTheDocument()
  })

  // Spec §6.1: with "Show archived" on and nothing back, there are no clients at all.
  it('does not count "Show archived" alone as a filter', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    await userEvent.click(await screen.findByRole('checkbox', { name: /mostrar arquivados/i }))
    await vi.waitFor(() => {
      expect(listClients).toHaveBeenLastCalledWith(expect.objectContaining({ includeArchived: true }))
    })

    expect(await screen.findByText('Ainda não há clientes')).toBeInTheDocument()
  })

  it('marks an archived client with a badge', async () => {
    listClients.mockResolvedValue([{ ...company, archivedAt: '2026-09-01T10:00:00.000Z' }])
    renderPage()

    expect(await screen.findByText('Arquivado')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Padaria Central, Lda.' })).toHaveClass('text-muted')
  })

  // A fetch failure must not be indistinguishable from "no clients yet":
  // `data` stays `undefined`, so a plain `data?.length === 0` check falls
  // through to the empty state (or an empty `.map()`) with no indication
  // anything went wrong. Same class of bug already fixed in
  // FiscalProfileForm/ClientDetailPage and AddEmploymentForm.
  it('shows an error message rather than the empty state when the fetch fails', async () => {
    listClients.mockRejectedValue(new ApiError('common.internal_error', {}, 500))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(/erro no servidor|server error/i)
    expect(screen.queryByText(/ainda não há clientes/i)).not.toBeInTheDocument()
  })

  it('passes the search term to the query', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    await userEvent.type(await screen.findByRole('searchbox'), 'padaria')

    await vi.waitFor(() => {
      expect(listClients).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'padaria' }))
    })
  })

  it('filters by kind', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    await userEvent.selectOptions(await screen.findByLabelText(/tipo|kind/i), 'COMPANY')

    await vi.waitFor(() => {
      expect(listClients).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'COMPANY' }))
    })
  })
})
```

Remove `within` from the `@testing-library/react` import (no longer used).

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- ClientListPage
```

Expected: FAIL — no count, no skeleton, no "Arquivado", one empty state for every case, no searchbox name.

- [ ] **Step 3: Write `kindTone.ts`**

```ts
import type { ClientKind } from '@ledger-hq/domain'
import type { BadgeTone } from '../ui'

export const KIND_TONE: Record<ClientKind, BadgeTone> = {
  COMPANY: 'neutral',
  INDIVIDUAL: 'accent',
}
```

- [ ] **Step 4: Write `ClientListSkeleton.tsx`**

```tsx
import { Card, Skeleton } from '../ui'

/** The rows only: the filter bar above does not depend on data and stays real. */
export function ClientListSkeleton() {
  return (
    <Card padding="none" className="px-5" aria-busy="true">
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <div
          key={row}
          className="flex min-h-[44px] items-center justify-between gap-4 border-b border-line py-3 last:border-b-0"
        >
          <Skeleton width="12rem" height="0.875rem" />
          <Skeleton width="5rem" height="1.25rem" />
        </div>
      ))}
    </Card>
  )
}
```

- [ ] **Step 5: Rewrite `ClientListPage.tsx`**

```tsx
import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Plus, Search, SearchX, Users } from 'lucide-react'
import { CLIENT_KIND_VALUES } from '@ledger-hq/domain'
import type { ClientKind } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Badge, Button, Card, Checkbox, DataList, EmptyState, Input, PageHeader, Select } from '../ui'
import { listClients } from './api'
import type { ClientFilters, ClientResponse } from './api'
import { ClientListSkeleton } from './ClientListSkeleton'
import { KIND_TONE } from './kindTone'

/**
 * Whether an empty result means "nothing matches" rather than "no clients".
 * "Show archived" alone is not a filter: with it on and nothing back, there
 * are no clients at all. Nor is a search of only spaces — the server trims it
 * to nothing.
 */
function isFiltered(filters: ClientFilters): boolean {
  return (filters.search ?? '').trim() !== '' || filters.kind !== undefined
}

function CreateClientButton() {
  const { t } = useTranslation('common')

  return (
    <Button asChild variant="primary">
      <Link to="/clients/new">
        <Plus aria-hidden="true" className="h-4 w-4" />
        {t('actions.create')}
      </Link>
    </Button>
  )
}

function ClientRow({ client }: { client: ClientResponse }) {
  const { t } = useTranslation(['clients', 'domain'])
  const archived = client.archivedAt !== null

  return (
    <DataList.Row
      label={
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <Link
              to="/clients/$clientId"
              params={{ clientId: client.id }}
              className={`truncate font-medium${archived ? ' text-muted' : ''}`}
            >
              {client.name}
            </Link>
            {archived && <Badge tone="neutral">{t('clients:archived')}</Badge>}
          </span>
          <span className="text-xs text-muted tabular-nums md:hidden">{client.taxId}</span>
        </span>
      }
      value={
        <>
          <span className="hidden text-muted tabular-nums md:inline">{client.taxId}</span>
          <Badge tone={KIND_TONE[client.kind]}>{t(`domain:clientKind.${client.kind}`)}</Badge>
        </>
      }
    />
  )
}

export function ClientListPage() {
  const { t } = useTranslation(['clients', 'common', 'domain'])
  const [filters, setFilters] = useState<ClientFilters>({})

  const clients = useQuery({
    queryKey: ['clients', filters],
    queryFn: () => listClients(filters),
    placeholderData: keepPreviousData,
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('clients:title')} actions={<CreateClientButton />} />

      <div className="flex flex-wrap items-center gap-4">
        <div className="w-full sm:w-auto sm:max-w-[360px] sm:flex-1">
          <Input
            type="search"
            leadingIcon={Search}
            hideLabel
            label={t('clients:filter.search')}
            placeholder={t('clients:filter.search')}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
          />
        </div>

        <Select
          layout="inline"
          label={t('clients:form.kind.label')}
          onChange={(event) => {
            const value = event.target.value
            setFilters((current) => {
              // exactOptionalPropertyTypes forbids setting an optional
              // property to `undefined`; omit the key instead to clear it.
              const { kind: _kind, ...rest } = current
              return value === '' ? rest : { ...rest, kind: value as ClientKind }
            })
          }}
        >
          <option value="">{t('clients:filter.all')}</option>
          {CLIENT_KIND_VALUES.map((kind) => (
            <option key={kind} value={kind}>
              {t(`domain:clientKind.${kind}`)}
            </option>
          ))}
        </Select>

        <Checkbox
          boxed
          label={t('clients:filter.showArchived')}
          onChange={(event) => setFilters((current) => ({ ...current, includeArchived: event.target.checked }))}
        />

        {/* Only once data exists, so it never reads "0" during the first load. */}
        {clients.data !== undefined && (
          <p className="ml-auto text-xs text-muted tabular-nums">
            {t('clients:count', { count: clients.data.length })}
          </p>
        )}
      </div>

      {/*
       * Without this split, a genuine fetch failure (`data` stays
       * `undefined`) would fall through to the `data?.length === 0` empty
       * state or an empty `.map()` — indistinguishable from "this client
       * truly has none yet". Same class of bug already fixed, with the
       * same reasoning, in FiscalProfileForm/ClientDetailPage and
       * AddEmploymentForm. `isPending` is true only for the first load:
       * `keepPreviousData` keeps the previous rows on screen while a filter
       * change fetches, rather than flashing the skeleton.
       */}
      {clients.isError ? (
        <ErrorMessage error={clients.error} />
      ) : clients.isPending ? (
        <ClientListSkeleton />
      ) : clients.data.length === 0 ? (
        isFiltered(filters) ? (
          <EmptyState icon={SearchX} title={t('clients:noMatches')} description={t('clients:noMatchesHint')} />
        ) : (
          <EmptyState
            icon={Users}
            title={t('clients:empty')}
            description={t('clients:emptyHint')}
            action={<CreateClientButton />}
          />
        )
      ) : (
        <Card padding="none" className="px-5">
          <DataList>
            {clients.data.map((client) => (
              <ClientRow key={client.id} client={client} />
            ))}
          </DataList>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- ClientListPage
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 12 `ClientListPage` tests PASS. If `t('clients:count', { count })` fails to type-check, the bundle's `count_one`/`count_other` pair is missing from `pt/clients.json` (Task 2) — the typed resources resolve the plural key from it.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/clients/kindTone.ts apps/web/src/clients/ClientListSkeleton.tsx apps/web/src/clients/ClientListPage.tsx apps/web/src/clients/ClientListPage.test.tsx
git commit -m "feat(web): restyle the client list with filters, count and two empty states" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `ClientForm`, and the create page on it

**Files:**
- Create: `apps/web/src/clients/ClientForm.tsx`
- Modify: `apps/web/src/clients/ClientFormPage.tsx`
- Test: `apps/web/src/clients/ClientFormPage.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Card`, `Input`, `PageHeader`, `Select`, `Textarea` from `../ui`; `createClientSchema`, `updateClientSchema` and the `*_VALUES` constants from `@ledger-hq/domain`; `ClientResponse` from `./api`; the Task 2 keys.
- Produces: `export type ClientFormProps = { mode: 'create'; onSubmit: (input: CreateClientInput) => void; isPending: boolean; error: unknown } | { mode: 'edit'; initial: ClientResponse; onSubmit: (input: UpdateClientInput) => void; isPending: boolean; error: unknown }` and `export function ClientForm(props: ClientFormProps)`. The edit branch (diff, cannot-clear, read-only kind) is written here and exercised by Task 10. `ClientFormPage` keeps its name and export (the router imports it).

- [ ] **Step 1: Update the create page's tests**

In `apps/web/src/clients/ClientFormPage.test.tsx`, the create form's submit is now "Criar" (spec §6.2). Replace every `screen.getByRole('button', { name: /guardar|save/i })` with `screen.getByRole('button', { name: /^criar$/i })`, then append inside the `describe`:

```tsx
  // Spec §10: still role="alert", now also tied to the field.
  it('links a field error to its field', async () => {
    renderPage()

    await userEvent.type(await screen.findByLabelText(/^nome$/i), 'Padaria')
    await userEvent.type(screen.getByLabelText(/^nif$/i), '000000000')
    await userEvent.click(screen.getByRole('button', { name: /^criar$/i }))

    const taxId = screen.getByLabelText(/^nif$/i)
    expect(taxId).toHaveAttribute('aria-invalid', 'true')
    expect(taxId).toHaveAccessibleDescription(/o nif não é válido/i)
  })

  it('clears the personal fields when the kind switches away and back', async () => {
    renderPage()

    await userEvent.selectOptions(await screen.findByLabelText(/^tipo$/i), 'INDIVIDUAL')
    await userEvent.type(screen.getByLabelText(/^niss$/i), '12345678901')
    await userEvent.selectOptions(screen.getByLabelText(/^tipo$/i), 'COMPANY')
    await userEvent.selectOptions(screen.getByLabelText(/^tipo$/i), 'INDIVIDUAL')

    expect(screen.getByLabelText(/^niss$/i)).toHaveValue('')
  })

  it('lays the form out in two titled sections and says where the fiscal profile went', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Novo cliente' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Identificação' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Contacto' })).toBeInTheDocument()
    expect(screen.getByText(/o perfil fiscal preenche-se depois/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveAttribute('href', '/clients')
    expect(screen.getByRole('link', { name: /cancelar/i })).toHaveAttribute('href', '/clients')
  })
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- ClientFormPage
```

Expected: FAIL — no "Criar" button (the form says "Guardar"), no `aria-describedby`, no section headings.

- [ ] **Step 3: Write `ClientForm.tsx`**

```tsx
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import {
  ACCOUNTING_VALUES,
  CLIENT_KIND_VALUES,
  LEGAL_FORM_VALUES,
  createClientSchema,
  updateClientSchema,
} from '@ledger-hq/domain'
import type { Accounting, ClientKind, CreateClientInput, LegalForm, UpdateClientInput } from '@ledger-hq/domain'
import { ErrorMessage, translateErrorCode } from '../shell/ErrorMessage'
import { Button, Card, Input, PageHeader, Select, Textarea } from '../ui'
import type { ClientResponse } from './api'

export type ClientFormProps =
  | { mode: 'create'; onSubmit: (input: CreateClientInput) => void; isPending: boolean; error: unknown }
  | {
      mode: 'edit'
      initial: ClientResponse
      onSubmit: (input: UpdateClientInput) => void
      isPending: boolean
      error: unknown
    }

type FormState = {
  kind: ClientKind
  name: string
  taxId: string
  accounting: Accounting
  legalForm: LegalForm
  socialSecurityNo: string
  dateOfBirth: string
  email: string
  phone: string
  notes: string
}

const initialState: FormState = {
  kind: 'COMPANY',
  name: '',
  taxId: '',
  accounting: 'ORGANIZED',
  legalForm: 'LDA',
  socialSecurityNo: '',
  dateOfBirth: '',
  email: '',
  phone: '',
  notes: '',
}

/** A loaded client as form state: an absent optional value is an empty string. */
function toFormState(client: ClientResponse): FormState {
  return {
    kind: client.kind,
    name: client.name,
    taxId: client.taxId,
    accounting: client.accounting,
    // Null only for an individual, whose form never shows or sends it.
    legalForm: (client.legalForm ?? 'LDA') as LegalForm,
    socialSecurityNo: client.socialSecurityNo ?? '',
    dateOfBirth: client.dateOfBirth ?? '',
    email: client.email ?? '',
    phone: client.phone ?? '',
    notes: client.notes ?? '',
  }
}

/** The schema rejects an empty optional string rather than treating it as absent. */
function emptyToUndefined(value: string): string | undefined {
  return value.trim() === '' ? undefined : value
}

function toCandidate(form: FormState): unknown {
  const shared = {
    name: form.name,
    taxId: form.taxId,
    accounting: form.accounting,
    email: emptyToUndefined(form.email),
    phone: emptyToUndefined(form.phone),
    notes: emptyToUndefined(form.notes),
  }

  if (form.kind === 'COMPANY') {
    return { kind: 'COMPANY', legalForm: form.legalForm, ...shared }
  }

  return {
    kind: 'INDIVIDUAL',
    socialSecurityNo: emptyToUndefined(form.socialSecurityNo),
    dateOfBirth: emptyToUndefined(form.dateOfBirth),
    ...shared,
  }
}

/** The optional fields — the only ones a user can try to empty. */
const CLEARABLE_FIELDS = ['email', 'phone', 'notes', 'socialSecurityNo', 'dateOfBirth'] as const

/**
 * `PATCH /clients/:id` cannot clear an optional field: an empty string fails
 * validation and an absent key means "unchanged". A field that had a value
 * and is now empty would appear to save while keeping the old value, so the
 * form refuses it instead (spec §6.2). Clearing needs the contract to accept
 * `null`, which is out of scope.
 */
function clearedFields(form: FormState, baseline: ClientResponse): string[] {
  return CLEARABLE_FIELDS.filter((field) => baseline[field] !== null && form[field].trim() === '')
}

/**
 * The validated candidate minus every field equal to its loaded value, plus
 * `kind` (the server requires it, and refuses a change). Parsed through the
 * update schema so the result is typed without a cast — it cannot fail: every
 * value already passed the create schema, which is stricter.
 */
function toUpdate(parsed: CreateClientInput, baseline: ClientResponse): UpdateClientInput {
  const changes: Record<string, unknown> = { kind: parsed.kind }

  for (const [field, value] of Object.entries(parsed)) {
    if (field === 'kind') continue
    if (value !== (baseline[field as keyof ClientResponse] ?? undefined)) changes[field] = value
  }

  return updateClientSchema.parse(changes)
}

/** The client form, for both creating and editing. The page owns the mutation and the navigation. */
export function ClientForm(props: ClientFormProps) {
  const { t } = useTranslation(['clients', 'common', 'domain'])
  const { t: tError } = useTranslation('errors')

  // The client as it was when the form opened. A background refetch while the
  // form is open (refocus, another tab) must not change what counts as
  // "changed", or a stale field the user never touched would be sent back
  // over a fresh one.
  const [baseline] = useState<ClientResponse | null>(() => (props.mode === 'edit' ? props.initial : null))
  const [form, setForm] = useState<FormState>(() =>
    props.mode === 'edit' ? toFormState(props.initial) : initialState,
  )
  const [showValidationError, setShowValidationError] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Map<string, string>>(new Map())

  /**
   * Per-field messages for the schema's own validation failures.
   *
   * `createClientSchema`'s refinements deliberately carry no `ErrorCode`
   * message (see the comment on `taxId` in
   * packages/domain/src/schemas/client.ts): that convention exists to avoid
   * colliding with the server-side pipe's code-promotion mechanism, so a
   * local `safeParse` failure here produces plain Zod issue codes
   * (`too_small`, `custom`, `invalid_format`, `invalid_value`, `too_big` —
   * confirmed empirically against this Zod version, not assumed), never a
   * domain `ErrorCode`. There is nothing in the `errors` namespace to look
   * those up against, so this switch calls `t()` on a literal key per
   * field — never on the field name itself — and stays entirely inside
   * `clients.json`'s `form.*.invalid` keys. It never touches
   * `packages/domain`, `ERROR_CODES`, or the `errors` namespace.
   */
  function translateFieldError(field: string): string | undefined {
    switch (field) {
      case 'name':
        return t('clients:form.name.invalid')
      case 'taxId':
        return t('clients:form.taxId.invalid')
      case 'accounting':
        return t('clients:form.accounting.invalid')
      case 'legalForm':
        return t('clients:form.legalForm.invalid')
      case 'socialSecurityNo':
        return t('clients:form.socialSecurityNo.invalid')
      case 'dateOfBirth':
        return t('clients:form.dateOfBirth.invalid')
      case 'email':
        return t('clients:form.email.invalid')
      case 'phone':
        return t('clients:form.phone.invalid')
      case 'notes':
        return t('clients:form.notes.invalid')
      default:
        return undefined
    }
  }

  function handleKindChange(next: ClientKind) {
    setForm((current) => ({
      ...current,
      kind: next,
      accounting: next === 'COMPANY' ? 'ORGANIZED' : 'SIMPLIFIED',
      legalForm: 'LDA',
      // Clearing rather than merely omitting: these fields must not survive
      // a switch away from the kind they belong to.
      socialSecurityNo: '',
      dateOfBirth: '',
    }))
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const result = createClientSchema.safeParse(toCandidate(form))
    const messages = new Map<string, string>()

    if (!result.success) {
      for (const field of new Set(result.error.issues.map((issue) => String(issue.path[0])))) {
        const message = translateFieldError(field)
        if (message !== undefined) messages.set(field, message)
      }
    }
    if (baseline !== null) {
      for (const field of clearedFields(form, baseline)) messages.set(field, t('clients:form.cannotClear'))
    }

    if (!result.success || messages.size > 0) {
      setShowValidationError(true)
      setFieldErrors(messages)
      return
    }

    setShowValidationError(false)
    setFieldErrors(new Map())

    if (props.mode === 'create') props.onSubmit(result.data)
    else props.onSubmit(toUpdate(result.data, baseline ?? props.initial))
  }

  const isEdit = props.mode === 'edit'
  const backLinkClass = 'inline-flex items-center gap-1 self-start text-sm font-medium text-muted hover:text-ink'

  return (
    // noValidate: the field errors below are the form's one validation voice.
    // The browser's own bubble (type="email") would pre-empt them and bypass
    // the Field contract.
    <form noValidate className="flex max-w-3xl flex-col gap-6" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-4">
        {props.mode === 'edit' ? (
          <Link to="/clients/$clientId" params={{ clientId: props.initial.id }} className={backLinkClass}>
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            {props.initial.name}
          </Link>
        ) : (
          <Link to="/clients" className={backLinkClass}>
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            {t('clients:title')}
          </Link>
        )}
        <PageHeader title={isEdit ? t('clients:editTitle') : t('clients:newTitle')} />
      </div>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t('clients:form.section.identification')}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label={t('clients:form.name.label')}
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            error={fieldErrors.get('name')}
          />
          <Input
            label={t('clients:form.taxId.label')}
            inputMode="numeric"
            value={form.taxId}
            onChange={(event) => update('taxId', event.target.value)}
            error={fieldErrors.get('taxId')}
          />
          {/* Disabled on edit because it genuinely cannot change: PATCH refuses
              a kind change with clients.kind_mismatch. */}
          <Select
            label={t('clients:form.kind.label')}
            value={form.kind}
            disabled={isEdit}
            hint={isEdit ? t('clients:form.kind.immutable') : undefined}
            onChange={(event) => handleKindChange(event.target.value as ClientKind)}
          >
            {CLIENT_KIND_VALUES.map((kind) => (
              <option key={kind} value={kind}>
                {t(`domain:clientKind.${kind}`)}
              </option>
            ))}
          </Select>

          {/* Kind-specific fields are absent, not disabled, for the other
              kind: disabled reads as "you may not edit this", not "this does
              not apply" (spec §3). */}
          {form.kind === 'COMPANY' && (
            <Select
              label={t('clients:form.legalForm.label')}
              value={form.legalForm}
              onChange={(event) => update('legalForm', event.target.value as LegalForm)}
              error={fieldErrors.get('legalForm')}
            >
              {LEGAL_FORM_VALUES.map((value) => (
                <option key={value} value={value}>
                  {t(`domain:legalForm.${value}`)}
                </option>
              ))}
            </Select>
          )}

          {form.kind === 'INDIVIDUAL' && (
            <>
              <Input
                label={t('clients:form.socialSecurityNo.label')}
                inputMode="numeric"
                value={form.socialSecurityNo}
                onChange={(event) => update('socialSecurityNo', event.target.value)}
                error={fieldErrors.get('socialSecurityNo')}
              />
              <Input
                type="date"
                label={t('clients:form.dateOfBirth.label')}
                value={form.dateOfBirth}
                onChange={(event) => update('dateOfBirth', event.target.value)}
                error={fieldErrors.get('dateOfBirth')}
              />
            </>
          )}

          <Select
            label={t('clients:form.accounting.label')}
            value={form.accounting}
            onChange={(event) => update('accounting', event.target.value as Accounting)}
            error={fieldErrors.get('accounting')}
          >
            {ACCOUNTING_VALUES.map((value) => (
              <option key={value} value={value}>
                {t(`domain:accounting.${value}`)}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t('clients:form.section.contact')}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            type="email"
            label={t('clients:form.email.label')}
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            error={fieldErrors.get('email')}
          />
          <Input
            label={t('clients:form.phone.label')}
            value={form.phone}
            onChange={(event) => update('phone', event.target.value)}
            error={fieldErrors.get('phone')}
          />
          <div className="md:col-span-2">
            <Textarea
              label={t('clients:form.notes.label')}
              value={form.notes}
              onChange={(event) => update('notes', event.target.value)}
              error={fieldErrors.get('notes')}
            />
          </div>
        </div>
      </Card>

      {showValidationError && (
        <p role="alert" className="text-sm text-danger-700">
          {translateErrorCode(tError, 'common.validation_failed')}
        </p>
      )}

      <ErrorMessage error={props.error} />

      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" type="submit" isLoading={props.isPending}>
          {isEdit ? t('common:actions.save') : t('common:actions.create')}
        </Button>
        <Button asChild variant="ghost">
          {props.mode === 'edit' ? (
            <Link to="/clients/$clientId" params={{ clientId: props.initial.id }}>
              {t('common:actions.cancel')}
            </Link>
          ) : (
            <Link to="/clients">{t('common:actions.cancel')}</Link>
          )}
        </Button>
        {!isEdit && <p className="ml-auto text-xs text-muted">{t('clients:form.profileLater')}</p>}
      </div>
    </form>
  )
}
```

`noValidate` is a small behaviour change from today (an invalid email used to be caught by the browser's bubble before the form's own message could show); the field error says the same thing, in the app's language and tied to the field.

- [ ] **Step 4: Rewrite `ClientFormPage.tsx` as the create page**

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { CreateClientInput } from '@ledger-hq/domain'
import { createClient } from './api'
import { ClientForm } from './ClientForm'

/** `/clients/new`. Keeps its name: the router imports it. */
export function ClientFormPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (input: CreateClientInput) => createClient(input),
    onSuccess: async (client) => {
      // Without this, the list page's cached (now-stale) result — fetched
      // before this client existed — is still within its 30s staleTime on
      // the next visit, so it renders "no clients yet" for up to half a
      // minute after creating one. Every other mutation that changes what
      // the list would show (archive, restore) already invalidates it.
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      await navigate({ to: '/clients/$clientId', params: { clientId: client.id } })
    },
  })

  return (
    <ClientForm
      mode="create"
      onSubmit={(input) => mutation.mutate(input)}
      isPending={mutation.isPending}
      error={mutation.error}
    />
  )
}
```

- [ ] **Step 5: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- ClientFormPage
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 7 `ClientFormPage` tests PASS — the four existing ones with the new button name, and the three added. If the `INDIVIDUAL` NISS value `12345678901` is rejected by `userEvent.type` for any reason, the switch test still holds: it only asserts the field is empty afterwards.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/clients/ClientForm.tsx apps/web/src/clients/ClientFormPage.tsx apps/web/src/clients/ClientFormPage.test.tsx
git commit -m "refactor(web): extract ClientForm and restyle the create page on it" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: The edit page and its route

**Files:**
- Create: `apps/web/src/clients/ClientFormSkeleton.tsx`
- Create: `apps/web/src/clients/ClientEditPage.tsx`
- Test: `apps/web/src/clients/ClientEditPage.test.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Consumes: `ClientForm` (Task 9); `getClient`, `updateClient`, `ClientResponse` from `./api`; `Card`, `Skeleton` from `../ui`; `ErrorMessage`.
- Produces: `export function ClientEditPage()` at `/clients/$clientId/edit`; `export function ClientFormSkeleton()`. Task 11 links to the route; the route must be registered before Task 11 type-checks.

- [ ] **Step 1: Write the failing test**

`apps/web/src/clients/ClientEditPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ApiError } from '../api/client'

const getClient = vi.hoisted(() => vi.fn())
const updateClient = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getClient, updateClient }))

const { ClientEditPage } = await import('./ClientEditPage')

await initI18n()
// Same pin as the rest of clients/*.test.tsx: jsdom reports
// navigator.language as "en-US", overriding the pt-PT fallback these
// Portuguese-only assertions rely on.
await i18next.changeLanguage('pt-PT')

const company = {
  id: '1',
  kind: 'COMPANY',
  name: 'Padaria Central, Lda.',
  taxId: '501442600',
  accounting: 'ORGANIZED',
  legalForm: 'LDA',
  email: 'geral@padaria.pt',
  phone: null,
  notes: null,
  socialSecurityNo: null,
  dateOfBirth: null,
  archivedAt: null,
}

// `useParams({ from })` needs the real parameterised route matched, and the
// success path navigates to the detail route, so both are registered. The
// detail route's component only proves where navigation landed.
function renderPage(clientId = '1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/clients/$clientId',
    component: () => <p>detalhe do cliente</p>,
  })
  const editRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/clients/$clientId/edit',
    component: ClientEditPage,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([detailRoute, editRoute]),
    history: createMemoryHistory({ initialEntries: [`/clients/${clientId}/edit`] }),
  })

  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )

  return { ...result, router, queryClient }
}

describe('ClientEditPage', () => {
  it('shows a form-shaped skeleton while the client loads', async () => {
    getClient.mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()

    await vi.waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull())
  })

  it('loads the client into the form', async () => {
    getClient.mockResolvedValue(company)
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Editar cliente' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^nome$/i)).toHaveValue('Padaria Central, Lda.')
    expect(screen.getByLabelText(/^nif$/i)).toHaveValue('501442600')
    expect(screen.getByLabelText(/^email$/i)).toHaveValue('geral@padaria.pt')
    expect(screen.getByRole('link', { name: 'Padaria Central, Lda.' })).toHaveAttribute('href', '/clients/1')
    expect(screen.queryByText(/o perfil fiscal preenche-se depois/i)).not.toBeInTheDocument()
  })

  it('shows the kind read-only, and says why', async () => {
    getClient.mockResolvedValue(company)
    renderPage()

    const kind = await screen.findByRole('combobox', { name: /^tipo$/i })
    expect(kind).toBeDisabled()
    expect(kind).toHaveAccessibleDescription(/não pode ser alterado/i)
  })

  // Spec §11: a diff bug could send nothing and "succeed" — assert the body.
  it('sends only the changed fields, plus kind', async () => {
    getClient.mockResolvedValue(company)
    updateClient.mockResolvedValue({ ...company, phone: '912345678' })
    renderPage()

    await userEvent.type(await screen.findByLabelText(/^telefone$/i), '912345678')
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    await vi.waitFor(() => {
      expect(updateClient).toHaveBeenCalledWith('1', { kind: 'COMPANY', phone: '912345678' })
    })
  })

  // Review Focus 3.
  it('sends kind alone when nothing changed, and still returns to the client', async () => {
    getClient.mockResolvedValue(company)
    updateClient.mockResolvedValue(company)
    const { router } = renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /^guardar$/i }))

    await vi.waitFor(() => expect(updateClient).toHaveBeenCalledWith('1', { kind: 'COMPANY' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/clients/1'))
  })

  it('refuses to empty a field that had a value', async () => {
    getClient.mockResolvedValue(company)
    renderPage()

    await userEvent.clear(await screen.findByLabelText(/^email$/i))
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    const email = screen.getByLabelText(/^email$/i)
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription(/ainda não pode ficar vazio/i)
    expect(updateClient).not.toHaveBeenCalled()
  })

  it('returns to the client page after saving', async () => {
    getClient.mockResolvedValue(company)
    updateClient.mockResolvedValue({ ...company, phone: '912345678' })
    const { router } = renderPage()

    await userEvent.type(await screen.findByLabelText(/^telefone$/i), '912345678')
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    expect(await screen.findByText('detalhe do cliente')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/clients/1')
  })

  // Review Focus 4.
  it("shows the server's refusal and keeps what was typed", async () => {
    getClient.mockResolvedValue(company)
    updateClient.mockRejectedValue(new ApiError('clients.archived', {}, 409))
    const { router } = renderPage()

    await userEvent.type(await screen.findByLabelText(/^telefone$/i), '912345678')
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    expect(await screen.findByText('O cliente está arquivado.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^telefone$/i)).toHaveValue('912345678')
    expect(router.state.location.pathname).toBe('/clients/1/edit')
  })

  // Review Focus 1: the diff is against the client as loaded, not as refetched.
  it('does not send a field the user never touched when the client refetches meanwhile', async () => {
    getClient.mockResolvedValue(company)
    updateClient.mockResolvedValue(company)
    const { queryClient } = renderPage()

    await userEvent.type(await screen.findByLabelText(/^telefone$/i), '912345678')
    queryClient.setQueryData(['client', '1'], { ...company, name: 'Padaria Renomeada, Lda.' })
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    await vi.waitFor(() => {
      expect(updateClient).toHaveBeenCalledWith('1', { kind: 'COMPANY', phone: '912345678' })
    })
  })

  // Review Focus 5.
  it('says the client was not found rather than showing an empty form', async () => {
    getClient.mockRejectedValue(new ApiError('common.not_found', {}, 404))
    renderPage('missing')

    expect(await screen.findByText('Registo não encontrado.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^nome$/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @ledger-hq/web test -- ClientEditPage
```

Expected: FAIL — `Failed to resolve import "./ClientEditPage"`.

- [ ] **Step 3: Write `ClientFormSkeleton.tsx`**

```tsx
import { Card, Skeleton } from '../ui'

/** The edit page while its client loads: back link, title, two sections of fields. */
export function ClientFormSkeleton() {
  return (
    <div className="flex max-w-3xl flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-4">
        <Skeleton width="8rem" height="0.875rem" />
        <Skeleton width="14rem" height="2rem" />
      </div>
      {[0, 1].map((section) => (
        <Card key={section} className="flex flex-col gap-4">
          <Skeleton width="7rem" height="0.75rem" />
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((field) => (
              <div key={field} className="flex flex-col gap-1.5">
                <Skeleton width="6rem" height="0.875rem" />
                <Skeleton height="2.5rem" />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Write `ClientEditPage.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { UpdateClientInput } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { getClient, updateClient } from './api'
import { ClientForm } from './ClientForm'
import { ClientFormSkeleton } from './ClientFormSkeleton'

/** `/clients/$clientId/edit`. */
export function ClientEditPage() {
  const { clientId } = useParams({ from: '/clients/$clientId/edit' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // The detail page's own key, so arriving from it is instant.
  const client = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => getClient(clientId),
  })

  const mutation = useMutation({
    mutationFn: (input: UpdateClientInput) => updateClient(clientId, input),
    onSuccess: async () => {
      // The detail page reads ['client', id] and the list ['clients', …];
      // both would otherwise show the old values until their staleTime ran out.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['client', clientId] }),
        queryClient.invalidateQueries({ queryKey: ['clients'] }),
      ])
      await navigate({ to: '/clients/$clientId', params: { clientId } })
    },
  })

  if (client.isPending) return <ClientFormSkeleton />
  if (client.isError) return <ErrorMessage error={client.error} />

  // An archived client's edit URL still renders the form: the server refuses
  // the save with clients.archived, and its message is the guard (spec §6.2).
  return (
    <ClientForm
      key={client.data.id}
      mode="edit"
      initial={client.data}
      onSubmit={(input) => mutation.mutate(input)}
      isPending={mutation.isPending}
      error={mutation.error}
    />
  )
}
```

- [ ] **Step 5: Register the route**

In `apps/web/src/router.tsx`, add the import after `ClientDetailPage`'s:

```tsx
import { ClientEditPage } from './clients/ClientEditPage'
```

after `clientDetailRoute`:

```tsx
const clientEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients/$clientId/edit',
  component: ClientEditPage,
})
```

and in `routeTree`, after `clientDetailRoute,`:

```tsx
    clientEditRoute,
```

TanStack Router ranks the static `edit` segment above the parameter, so `/clients/abc/edit` never matches the detail route; no existing path changes.

- [ ] **Step 6: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- ClientEditPage ClientFormPage
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 10 `ClientEditPage` tests PASS and the 7 `ClientFormPage` tests still PASS. If the refetch test sends `name` as well, the form is diffing against `props.initial` instead of its `baseline` snapshot — fix `ClientForm`, not the test.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/clients/ClientFormSkeleton.tsx apps/web/src/clients/ClientEditPage.tsx apps/web/src/clients/ClientEditPage.test.tsx apps/web/src/router.tsx
git commit -m "feat(web): edit a client at /clients/\$clientId/edit" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: The Edit button on the client page

**Files:**
- Modify: `apps/web/src/clients/ClientDetailPage.tsx` (the header only)
- Test: `apps/web/src/clients/ClientDetailPage.test.tsx`

**Interfaces:**
- Consumes: `Button` (asChild) from `../ui`; the route from Task 10.
- Produces: nothing later tasks import. **Nothing else on this page changes in this stage** (spec §6.3, §11) — its sections, tabs and dialogs are Stage 3.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('ClientDetailPage', …)` in `apps/web/src/clients/ClientDetailPage.test.tsx`:

```tsx
  it('links to the edit page', async () => {
    getClient.mockResolvedValue(company)
    getFiscalProfile.mockRejectedValue(new ApiError('common.not_found', {}, 404))
    renderPage('1')

    expect(await screen.findByRole('link', { name: /^editar$/i })).toHaveAttribute('href', '/clients/1/edit')
    expect(screen.getByRole('button', { name: /^arquivar$/i })).toBeInTheDocument()
  })

  // The server refuses to edit an archived client; the button is not offered.
  it('offers no Edit for an archived client, only Restore', async () => {
    getClient.mockResolvedValue({ ...company, archivedAt: '2026-09-01T10:00:00.000Z' })
    getFiscalProfile.mockRejectedValue(new ApiError('common.not_found', {}, 404))
    renderPage('1')

    expect(await screen.findByRole('button', { name: /^restaurar$/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^editar$/i })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @ledger-hq/web test -- ClientDetailPage
```

Expected: the first new test FAILS (no Edit link); the second passes vacuously until the link exists.

- [ ] **Step 3: Replace the header's buttons**

In `ClientDetailPage.tsx`, replace the `{record.archivedAt === null ? ( <button …> ) : ( <button …> )}` block inside `<header>` with:

```tsx
        <div className="flex items-center gap-4">
          {record.archivedAt === null ? (
            <>
              <Button asChild variant="secondary">
                <Link to="/clients/$clientId/edit" params={{ clientId }}>
                  {t('common:actions.edit')}
                </Link>
              </Button>
              <Button variant="secondary" onClick={() => archiveMutation.mutate()} isLoading={archiveMutation.isPending}>
                {t('common:actions.archive')}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => restoreMutation.mutate()} isLoading={restoreMutation.isPending}>
              {t('common:actions.restore')}
            </Button>
          )}
        </div>
```

Change the `<header className="flex items-center justify-between">` to `<header className="flex items-center justify-between gap-4">`. Update the imports: `import { Link, useParams } from '@tanstack/react-router'` and add `import { Button } from '../ui'`. Nothing else in the file changes.

- [ ] **Step 4: Run the tests, the type check and the linter**

```bash
pnpm --filter @ledger-hq/web test -- ClientDetailPage
pnpm --filter @ledger-hq/web typecheck
pnpm --filter @ledger-hq/web lint
```

Expected: 4 `ClientDetailPage` tests PASS; the `to="/clients/$clientId/edit"` type-checks because Task 10 registered the route.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/clients/ClientDetailPage.tsx apps/web/src/clients/ClientDetailPage.test.tsx
git commit -m "feat(web): add the Edit button to the client page" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: End-to-end, the guidelines, and the definition of done

**Files:**
- Modify: `apps/web/e2e/setup-and-clients.spec.ts`
- Modify: `apps/web/e2e/obligations.spec.ts`, `apps/web/e2e/billing.spec.ts`, `apps/web/e2e/search-and-reporting.spec.ts`, `apps/web/e2e/vault-offline.spec.ts`
- Modify: `docs/design/guidelines.md`
- Modify: `docs/design/roadmap.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the stage's definition of done.

- [ ] **Step 1: Make every client-creating spec use the new create form**

Two things changed for every spec that registers a client through the UI: the form's submit reads **Criar**, not *Guardar*; and when the list is empty, the page has **two** "Criar" links (header and empty state), which Playwright's strict mode refuses to click ambiguously. In each of the five files, after every `page.getByRole('link', { name: /criar/i }).click()` that opens the client form:

1. replace that line with

   ```ts
   await page.getByRole('link', { name: /^criar$/i }).first().click()
   ```

2. replace the **first** `page.getByRole('button', { name: /guardar/i }).click()` that follows it — the one that submits the client form — with

   ```ts
   await page.getByRole('button', { name: /^criar$/i }).click()
   ```

   A second `/guardar/i` click right after (commented `// fiscal profile defaults` or similar) saves the fiscal profile on the client page and **stays as it is**.

Find them with:

```bash
cd /Users/pauloaraujo/Projects/personal/ledger-hq/apps/web
grep -n "name: /criar/i })\|name: /guardar/i })" e2e/*.ts
```

The sites, as of this plan: `setup-and-clients.spec.ts` lines 33/37 and 43/47; `obligations.spec.ts` 33/37 and 101/105; `search-and-reporting.spec.ts` 21/25 and 40/44; `billing.spec.ts` 33/37 and 121/127; `vault-offline.spec.ts` 29/39. Leave every `/criar|entrar/i` (sign-in) and `vault-offline.spec.ts`'s later `/criar/i` buttons (platform and credential forms) alone.

- [ ] **Step 2: Add the edit journey and the phone-width row to `setup-and-clients.spec.ts`**

At the end of the first test (after `await expect(page.getByText(/em vigor/i)).toBeVisible()`), add:

```ts
  // Edit the company: change its phone, save, and see it on the client page.
  await page.getByRole('link', { name: /^editar$/i }).click()
  await page.getByLabel(/^telefone$/i).fill('912 345 678')
  await page.getByRole('button', { name: /^guardar$/i }).click()
  await expect(page).toHaveURL(/\/clients\/[^/]+$/)
  await expect(page.getByText('912 345 678')).toBeVisible()

  // At phone width a list row shows the tax number under the name (the desktop
  // column is display:none, so only the caption is visible).
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/clients')
  const nameLink = page.getByRole('link', { name: 'Padaria Central, Lda.' })
  const taxIdCaption = page.getByText('501442600').filter({ visible: true })
  await expect(taxIdCaption).toBeVisible()
  const nameBox = await nameLink.boundingBox()
  const taxIdBox = await taxIdCaption.boundingBox()
  expect(nameBox).not.toBeNull()
  expect(taxIdBox).not.toBeNull()
  expect(taxIdBox?.y ?? 0).toBeGreaterThan(nameBox?.y ?? 0)
```

- [ ] **Step 3: Run the end-to-end suite**

```bash
pnpm --filter @ledger-hq/web test:e2e
```

Expected: PASS. A failure in a step this task did not touch belongs to an earlier phase's flow — check it against what that phase shipped before changing anything.

- [ ] **Step 4: Add the Forms section to `docs/design/guidelines.md`**

Insert after §2 "Which component for which job", renumbering the sections below it (§3 Accessibility becomes §4, and so on):

```markdown
## 3. Forms

Four controls, all in `apps/web/src/ui/`:

| Control | For |
|---|---|
| `Input` | one line of text, a number, a date (the browser's own picker), an email, a search |
| `Textarea` | prose — notes, reasons. Regular weight, grows downwards |
| `Select` | a choice among a handful of options, as `<option>` children built from a `*_VALUES` constant. Native, so the phone shows its own picker |
| `Checkbox` | a yes/no. `boxed` in a filter bar, so it sits level with the other controls |

**The `Field` contract.** `Input`, `Textarea` and `Select` render through
one internal `Field`, so label, hint and error behave identically
everywhere:

- `label` is required and is the accessible name. `hideLabel` hides it
  visually and keeps the name — for a search box whose icon and
  placeholder say what it is. A placeholder is never the label.
- `hint` sits under the control; `error` under the hint, with an icon and
  `role="alert"`. Both are joined to the control by `aria-describedby`,
  hint first; a caller's own `aria-describedby` is appended. `error` also
  sets `aria-invalid` and the danger border — the border is never the only
  signal.
- `className` and `ref` land on the native control, never on a wrapper.
  To override a control's 40px height use the important modifier
  (`className="h-9!"`); two height utilities on one element are not
  resolved by their order.

**Disabled means "cannot change"**, never "does not apply". A client's
kind on the edit form is disabled, with a hint saying why. Fields that do
not apply to the record are not rendered.

**`Select layout="inline"`** — label beside the control — is for filter
bars only. It takes no hint and no error; the type forbids them.

**A link that looks like a button** is `<Button asChild>` around a `Link`.
It takes no `type`, no `isLoading` and no `disabled` — the type forbids
all three: a link does not load, and one that cannot be followed is not
rendered.

**Field errors are the form's one validation voice.** A form that runs
its own validation and shows field errors sets `noValidate`, so the
browser's bubble never pre-empts the field's own message. A form that
validates only on the server may keep the browser's `required` and
`type="url"` checks.
```

Then append to the (renumbered) accessibility checklist:

```markdown
10. Every form control has a programmatic label — visible, or hidden with
    `hideLabel`. A placeholder is never the label.
11. A field error is announced (`role="alert"`), tied to its control by
    `aria-describedby`, and marked with `aria-invalid`.
12. Disabled means "cannot change"; a field that does not apply is not
    rendered.
13. Controls are 40px tall; a filter bar's boxed checkbox matches, and the
    whole box is the touch target.
14. Focus order in a form follows reading order, section by section.
```

And in §1 "Spacing, radius, elevation", after the three-gaps paragraph, add:

```markdown
Inside a single control — label to box, icon to text — `gap-1.5` or
`gap-2` is the control's own business; the three gaps are between
elements.
```

- [ ] **Step 5: Mark Stage 2 shipped in `docs/design/roadmap.md`**

Under `## Stage 2 — Clients list & form`, change `**Status:** specced.` to `**Status:** shipped.`, and add after the `[Spec]` line:

```markdown
- [Plan](../superpowers/plans/2026-10-04-ui-refresh-stage-2.md).
```

- [ ] **Step 6: Run the whole definition of done**

```bash
cd /Users/pauloaraujo/Projects/personal/ledger-hq
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @ledger-hq/web i18n:check
pnpm --filter @ledger-hq/web test:e2e
```

Expected: all PASS. Then compare the browser at 1280×800 and 390×844 against the boards from Task 1 — Clients (loaded, loading, no clients, no matches, an archived row), New client, Edit client (with the cannot-clear error), the sidebar search box and the period-summary dates. A mismatch is raised with the human partner, not silently resolved in either direction.

- [ ] **Step 7: Commit**

```bash
git add apps/web/e2e docs/design/guidelines.md docs/design/roadmap.md
git commit -m "test(web): cover client edit end to end, and document the form controls" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review against the spec

- §1 Ships — controls (Tasks 4-6), `Button asChild` (3), list (8), form split with create and edit (9-10), Edit on the detail header (11), search box and dates (7), i18n (2), guidelines (12). Does-not-ship: the detail page beyond its header buttons, `MoneyInput`, `Dialog`/`Tabs`/`Toast`, any API change — no task touches them.
- §2 Departures — native `Select`/`Checkbox` (5, 6); edit in scope (9-11); search box and dates (7).
- §3 Boards — Task 1, including the three spec overrides; compared in Task 12.
- §4 Dependency — Task 3 Step 1, with the peer check and the stop condition.
- §5.1-5.6 — Tasks 4, 4, 5, 5, 6, 3. `FieldProps` members admit `undefined` (Global Constraints).
- §6.1 — Task 8, both empty states, count, skeleton, archived row, kind tone. §6.2 — Tasks 9-10: back link, sections, grid, numeric input modes, footer, read-only kind, no client-side archived guard, cannot-clear, diff plus `kind`, both invalidations. §6.3 — Task 11. §6.4 — Task 10 Step 5. §6.5-6.6 — Task 7.
- §7 File layout — as listed, plus `ClientFormSkeleton.tsx` (explained under File Structure).
- §8 i18n — Task 2, in the bundle's *tu* register; plural pair checked in Step 3.
- §9 Accessibility 1-5 — Tasks 4-6 tests (1, 2, 4), Task 10's read-only kind (3), Task 9's section order (5).
- §10 Testing — every listed test is in Tasks 3-11; e2e in Task 12. **Addition:** four more e2e specs register clients through the create form and are updated in Task 12 Step 1; the spec did not list them.
- §11 Risks — the ref (Task 4 test, Task 7), the diff body (Task 10), scope creep (Task 11's "nothing else changes").
- §12 Guidelines — Task 12 Step 4.
