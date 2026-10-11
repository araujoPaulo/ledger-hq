# UI refresh, Stage 2 — design specification

**Date:** 2026-10-04
**Status:** approved
**Revised:** 2026-10-11 — folds in what writing the implementation plan
found: the `pt-PT` register (§2.4, §8), `FieldProps` admitting
`undefined` (§5.1), the `ref` and `className` contract (§5.2), the
edit diff's baseline (§6.2), the form's `noValidate` (§6.2), the
edit page's skeleton file (§7) and the e2e specs the new submit label
touches (§10).
**Parent:** [UI refresh design](./2026-09-19-ui-refresh-design.md) ·
[roadmap](../../design/roadmap.md) ·
[Stage 1](./2026-09-24-ui-refresh-stage-1-design.md) ·
[screens](https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92)

Stage 2 gives the design system its form controls and applies them to
client management's standalone screens. Every later stage has a form on
it, so the control APIs fixed here are the ones Stages 3-5 build on. Where
this document repeats the parent spec it is the contract; where it departs
from the roadmap, §2 says so and why.

## 1. Scope

**Ships:**

- Four form controls in `apps/web/src/ui/`: `Input`, `Textarea`,
  `Select`, `Checkbox`, sharing one internal `Field` wrapper.
- `Button` gains `asChild`, so a router `Link` can wear button styling.
- `ClientListPage` restyled: page header, filter bar, result count,
  rows, loading and two distinct empty states.
- `ClientFormPage` restyled and split, so the same form serves **create
  and edit**. Edit is new: a route `/clients/$clientId/edit` and an
  "Edit" button on the client detail header.
- The two plain inputs Phase 4b left for this stage adopt `Input`:
  `search/SearchBox.tsx` and the date range in
  `reporting/PeriodSummaryReport.tsx`.
- New i18n keys (§8), both locales.
- `docs/design/guidelines.md` extended with the form controls.

**Does not ship:**

- The rest of `ClientDetailPage`. Only its header gains the Edit button;
  its sections, tabs and dialogs are Stage 3.
- `MoneyInput`. No Stage 2 screen takes an amount; it lands in Stage 3
  against the four billing forms that do.
- `Dialog`, `Tabs`, `Toast` — Stage 3.
- Any API change. Edit uses the existing `PATCH /clients/:id` and the
  existing, until now unused, `updateClient` in `clients/api.ts`.

## 2. Departures from the roadmap

1. **`Select` and `Checkbox` are native elements, styled — not Radix.**
   The roadmap named `@radix-ui/react-select` and
   `@radix-ui/react-checkbox`. Every select in the app has two to six
   options; a native `<select>` gives the phone's own picker (the better
   control on the mobile frame), participates in `<form>` submission and
   `required` with no hidden-input shim, and is driven by
   `userEvent.selectOptions` in JSDOM, where Radix Select needs pointer-
   event polyfills. A native checkbox styled with `accent-color` matches
   the drawn checkbox exactly. Neither Radix package is added.
2. **Client edit is in scope.** The roadmap called the stage "create/edit
   form", but no edit screen exists. The detail mockup draws an Edit
   button and the endpoint exists, so the form gains an edit mode here
   rather than shipping a button with nowhere to go. This is the
   refresh's one new route; it adds a path and changes none.
3. **The search box and the period-summary dates are in scope.** Phase
   4b shipped both as plain inputs on purpose, recording that Stage 2
   would adopt them together with the client filter bar
   (`docs/superpowers/plans/2026-09-29-phase-4b-search-and-reporting.md`,
   Task 5). Leaving them would make Stage 2 finish with two unstyled
   inputs in the shell.
4. **`pt-PT` copy uses *tu*, as the bundle does.** Every existing
   `clients` string is informal ("Indica um nome válido.", "Escolhe uma
   forma jurídica válida."). The new strings follow it; §8 is written
   that way.

## 3. Visual reference

| Artboard | What it fixes |
|---|---|
| Clients — desktop | page header, filter bar, count, rows, the archived row |
| Clients — mobile | two-line rows, filter bar wrapping |
| New client — desktop | the sectioned form, field error, footer hint |
| New client — mobile | the form in one column |

**Not drawn, and specified here in words:** the edit form (the same board
with the title "Edit client", the kind shown read-only, and no footer
hint), the list's loading and empty states, and the restyled search box
and date range. Drawing them on the canvas, desktop and mobile, is the
first task of the implementation plan; the boards then outrank this
section where they disagree.

**Where this spec overrides the boards:**

- The mobile Clients board puts a "Create" icon in the top bar. The top
  bar belongs to the shell and is the same on every page; a page-specific
  action there means threading per-route actions through `AppLayout`.
  The Create button stays in the page's `PageHeader`, which already wraps
  its actions below the title on mobile.
- The form board shows *Date of birth* disabled with the placeholder
  "Individuals only" while the kind is Company. The form keeps today's
  behaviour — kind-specific fields are absent, not disabled, for the
  other kind — because a disabled field reads as "you may not edit this"
  rather than "this does not apply", and today's code already clears
  those fields on a kind switch.
- The boards predate Phase 4b and show three nav items and no search box.
  The shell as shipped (four items, search in the sidebar) is correct.

## 4. Dependencies

| Package | Why |
|---|---|
| `@radix-ui/react-slot` | `Button asChild` — Stage 1 deferred it to here, naming the list's Create link as its first consumer |

Verify at install that its peer range includes React 19, as Stage 1 did
for the dropdown menu. Fallback if it does not: a `buttonClasses()`
export from `Button.tsx` that a `Link` applies directly.

## 5. Components

Conventions from Stage 1 hold: named exports, props extend the element's
own props, `cva` for variants, no component sets its own margin, nothing
in `ui/` imports from a feature folder.

### 5.1 `Field` (internal)

Not exported from `ui/index.ts`. `Input`, `Textarea` and `Select` render
through it so that label, hint and error behave identically everywhere.

```ts
type FieldProps = {
  label: string
  hideLabel?: boolean | undefined   // visually hidden, still the accessible name
  hint?: string | undefined
  error?: string | undefined
}
```

Optional members admit `undefined` explicitly, so a caller under
`exactOptionalPropertyTypes` can pass `error={errors.get('name')}`.

- One `useId()` per field; the control gets `id`, the label `htmlFor`.
- `aria-describedby` lists the hint's id and the error's id, in that
  order, whichever are present. A control passed its own
  `aria-describedby` has it appended, not replaced.
- `error` sets `aria-invalid="true"` on the control, a `border-danger-700`
  border, and renders below it: a `CircleAlert` icon (`aria-hidden`) and
  the message at `text-xs font-medium text-danger-700`, with
  `role="alert"` — the role existing field errors already carry, which the
  current `ClientFormPage` tests query by.
- `hint` renders at `text-xs text-muted` under the control, above the
  error.
- Layout: label (`text-sm font-medium text-muted`) above the control,
  `gap-1.5`. `Select` alone also supports a label beside it (§5.4).

### 5.2 `Input`

```ts
type InputProps = ComponentProps<'input'> & FieldProps & {
  leadingIcon?: LucideIcon | undefined
}
```

- `className` and `ref` land on the `<input>`, never on a wrapper
  (React 19: `ref` is an ordinary prop, typed through
  `ComponentProps<'input'>`). `InputProps` is exported — Stage 3's
  `MoneyInput` derives from it. The same holds for `Textarea`, `Select`
  and `Checkbox` on their own elements.
- Tailwind does not resolve two utilities for one property by their
  order in the class string, so a control never emits two, and a caller
  overriding the 40px height uses the important modifier (`h-9!`).

- 40px tall (`h-10`), `px-3`, `text-sm`, `bg-surface`,
  `border-line-strong`, `rounded-surface`. Focus:
  `focus-visible:ring-2 ring-accent-600` with the border kept.
- Disabled: `bg-ground text-subtle border-line`, `cursor-not-allowed`.
- `leadingIcon` draws a 16px `text-subtle` icon inside the left edge and
  pads the text past it — the filter bar's and the sidebar's search.
- `type="date"`, `type="email"`, `type="search"` and the rest pass
  through untouched. Dates keep the browser's own picker.
- Numbers and tax numbers in an `Input` are `tabular-nums` when the
  caller passes `inputMode="numeric"`.

### 5.3 `Textarea`

```ts
type TextareaProps = ComponentProps<'textarea'> & FieldProps
```

The `Input` treatment, `min-h-24`, `resize-y`, `py-2.5`. Weight 400 —
it holds prose (Stage 1's rule for the 400 weight).

### 5.4 `Select`

```ts
type SelectProps = ComponentProps<'select'> & Pick<FieldProps, 'label' | 'hideLabel'> & (
  | { layout?: 'stacked'; hint?: string | undefined; error?: string | undefined }   // default
  | { layout: 'inline'; hint?: never; error?: never }
)
```

- A native `<select>` with `appearance-none`, the `Input` box, and a
  `ChevronDown` (`aria-hidden`, `pointer-events-none`) at the right.
- Options are children: `<option>` elements, exactly as today. The
  component does not take an `options` array, because every call site
  already builds its options from a `*_VALUES` constant and a `t()`
  call, and a second shape would add a mapping step for nothing.
- `layout="inline"` puts the label to the left of the control on one
  line — the filter bar's "Kind". Hint and error are not supported
  inline (the type forbids them), because a filter has neither.

### 5.5 `Checkbox`

```ts
type CheckboxProps = Omit<ComponentProps<'input'>, 'type'> & {
  label: string
  description?: string | undefined
  boxed?: boolean | undefined
}
```

- A native `<input type="checkbox">`, 16px, `accent-accent-600`, label to
  its right at `text-sm`. The whole label is the click target.
- `description` adds a `text-xs text-muted` line under the label, joined
  to the input by `aria-describedby`.
- `boxed` wraps the pair in a 40px bordered box matching `Input`'s
  height — the filter bar's "Show archived", so it sits level with the
  search and the select.
- Checkbox does not use `Field`: its label sits beside it and it has no
  error state in any current form.

### 5.6 `Button` — `asChild`

```ts
type ButtonProps = … & { asChild?: boolean }
```

With `asChild`, `Button` renders Radix's `Slot` instead of `<button>`:
the single child (a `Link`) receives the button classes and props. Three
rules:

- `type` is not forwarded under `asChild` — `type="button"` on an anchor
  is invalid.
- `isLoading` is not supported with `asChild` (the type forbids the
  combination): `Slot` needs exactly one child, and a link does not
  load.
- `disabled` is not supported either; a link that cannot be followed
  should not be rendered.

## 6. Screens

### 6.1 `clients/ClientListPage.tsx`

Today: an `<h1>`, a raw link styled as a dark button, three unstyled
controls, an empty `<ul>` while loading, a grey sentence when empty.

Target:

```tsx
<div className="flex flex-col gap-6">
  <PageHeader title={t('clients:title')} actions={<CreateButton />} />
  <ClientFilters value={filters} onChange={setFilters} count={…} />
  {/* error | skeleton | empty | list */}
</div>
```

- **Header.** `PageHeader` with `<Button asChild variant="primary">`
  around a `Link` to `/clients/new`, a `Plus` icon and
  `common:actions.create`.
- **Filter bar** (inline in the page, not a new file): an `Input
  type="search"` with `leadingIcon={Search}`, `hideLabel`, label and
  placeholder `clients:filter.search`; a `Select layout="inline"`
  labelled `clients:form.kind.label` with the "All" option first; a
  `Checkbox boxed` labelled `clients:filter.showArchived`. The bar wraps;
  the search grows to a 360px maximum. The filter state and its
  `exactOptionalPropertyTypes` handling are unchanged.
- **Count.** Right-aligned at the end of the bar, `text-xs text-muted
  tabular-nums`: `clients:count` with i18next plurals ("1 client", "24
  clients"). Shown only when `data` is defined, so it never reads "0"
  during the first load.
- **Rows.** `Card padding="none" className="px-5"` holding a `DataList`
  — three values fit its two slots:
  - label: the client name as a `Link` to `/clients/$clientId`,
    `font-medium`; on mobile, the tax number below it as a `text-xs
    text-muted tabular-nums` caption (`md:hidden`).
  - value: the tax number (`hidden md:inline`, `tabular-nums`,
    `text-muted`) and a kind `Badge`.
  - Kind tone comes from a new `clients/kindTone.ts`:
    `{ COMPANY: 'neutral', INDIVIDUAL: 'accent' }`, the
    `URGENCY_TONE` shape.
  - An archived client (`archivedAt !== null`) renders its name in
    `text-muted` and adds a `Badge tone="neutral"` reading
    `clients:archived` after it. Archived rows only appear with the
    checkbox on, which is the only time the reader needs the
    distinction.
- **Loading.** `ClientListSkeleton.tsx`, sibling file: the filter bar is
  real (it does not depend on data), and below it a `Card` with six
  `Skeleton` rows. Shown only while `isPending` — the query keeps
  `placeholderData: keepPreviousData`, so changing a filter keeps the
  previous rows on screen rather than flashing the skeleton.
- **Empty, two kinds.** Distinguishing them is the reason this screen
  needs two keys:
  - **No clients at all** (empty result with no search text and no kind
    filter): `EmptyState icon={Users}`, title `clients:empty`,
    description `clients:emptyHint`, and the Create button as `action`
    — the first `EmptyState` in the app with a CTA, which Stage 1 built
    the prop for.
  - **Filters match nothing**: `EmptyState icon={SearchX}`, title
    `clients:noMatches`, description `clients:noMatchesHint`, no action.
    "Show archived" alone does not count as a filter: with it on and no
    results, there are no clients at all.
- **Error.** `ErrorMessage`, unchanged, and still checked before the
  empty branch (the comment explaining why stays).

### 6.2 The client form — create and edit

`ClientFormPage.tsx` is the largest file in the app (336 lines) and is
about to gain a second mode. It splits three ways:

```
clients/
  ClientForm.tsx        the form itself: state, validation, fields, footer
  ClientFormPage.tsx    /clients/new — create mode (keeps its name: the router imports it)
  ClientEditPage.tsx    /clients/$clientId/edit — loads the client, edit mode
```

```ts
type ClientFormProps =
  | { mode: 'create'; onSubmit: (input: CreateClientInput) => void; isPending: boolean; error: unknown }
  | { mode: 'edit'; initial: ClientResponse; onSubmit: (input: UpdateClientInput) => void; isPending: boolean; error: unknown }
```

The pages own their mutation and navigation; the form owns state,
`safeParse`, `translateFieldError` and rendering. Today's
`translateFieldError` switch and its long comment move into
`ClientForm.tsx` unchanged.

**Layout** (both modes):

- Above the title, a back link to `/clients` (`ChevronLeft` + the
  `clients:title` text) — on edit, back to the client instead, labelled
  with the client's name.
- `PageHeader` title `clients:newTitle` or `clients:editTitle`. Content
  `max-w-3xl`.
- Two `Card` sections, each with an `<h2>` at `text-xs font-semibold
  uppercase tracking-wide text-muted`:
  - **Identification** (`clients:form.section.identification`): name,
    tax number, kind, then legal form (company) or social security
    number and date of birth (individual), then accounting.
  - **Contact** (`clients:form.section.contact`): email, phone, then
    notes as a full-width `Textarea`.
  - Fields sit in a `grid md:grid-cols-2 gap-4`; one column below `md`.
- Every field is an `Input`, `Select` or `Textarea` with `error` set from
  the existing `fieldErrors` map. The separate `{fieldError('x')}`
  paragraphs disappear — `Field` renders them.
- Tax number and social security number take `inputMode="numeric"`.
- Footer row: `Button variant="primary" type="submit" isLoading=
  {isPending}` (`common:actions.create` on create,
  `common:actions.save` on edit), a `ghost` Cancel link back, and — on
  create only — `clients:form.profileLater` right-aligned in
  `text-xs text-muted`: the fiscal profile is not on this form, and the
  hint tells the reader where it went.
- The form-level `common.validation_failed` alert and `ErrorMessage`
  stay, above the footer.
- The form sets `noValidate`: the field errors are its one validation
  voice, and the browser's bubble on `type="email"` would pre-empt them.

**Edit mode specifics:**

- `ClientEditPage` reads the client through the existing
  `['client', clientId]` query (the detail page's key, so arriving from
  the detail page is instant). While pending it renders a form-shaped
  skeleton (`ClientFormSkeleton.tsx`); on error, `ErrorMessage` — a
  missing client reads "not found", never an empty form.
- **The kind is read-only.** `PATCH` refuses a kind change with
  `clients.kind_mismatch`. The kind renders as a disabled `Select`
  with `hint={t('clients:form.kind.immutable')}`. Disabled is right
  here, unlike the board's disabled date of birth: this field *does*
  apply and genuinely cannot change.
- **An archived client cannot be edited** — the server answers
  `clients.archived` (409). The Edit button is not rendered for an
  archived client; a direct visit to the URL shows the form with an
  `ErrorMessage` on submit, the server's own message. No client-side
  guard duplicates the rule.
- **Emptying a field that had a value is refused on the client.** The
  `PATCH` contract has no way to clear an optional field: an empty
  string fails validation and an absent key means "unchanged", so the
  form would appear to save while keeping the old value. When a field
  that was non-null in `initial` is submitted empty, the form blocks
  the submit and puts `clients:form.cannotClear` on that field.
  Recorded as a known limitation; clearing needs a contract change
  (accepting `null`) that is out of scope.
- What is sent: the candidate built by today's `toCandidate`, minus every
  field equal to its `initial` value, plus `kind`. `initial` means the
  client **as loaded when the form opened**: a background refetch while
  the form is open must not change what counts as changed, or a field
  the user never touched would be sent back stale over a fresh value.
  Saving with nothing changed sends `{ kind }` alone and succeeds. Validation runs on the
  full candidate through `createClientSchema` — the same rules as create
  — before the diff is taken.
- On success: invalidate `['client', clientId]` and `['clients']`, then
  navigate to `/clients/$clientId`.

**Create mode** keeps today's behaviour exactly: kind switch resets the
kind-specific fields, success invalidates `['clients']` and navigates to
the new client.

### 6.3 `clients/ClientDetailPage.tsx` — the Edit button only

The header gains `<Button asChild variant="secondary">` around a `Link`
to `/clients/$clientId/edit`, labelled `common:actions.edit`, beside
Archive/Restore and only while `archivedAt === null`. Archive and
Restore become `Button variant="secondary"` in the same pass, so the two
buttons beside each other match. Nothing else on the page changes in
this stage.

### 6.4 `router.tsx`

```ts
const clientEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients/$clientId/edit',
  component: ClientEditPage,
})
```

Added to the route tree after `clientDetailRoute`. TanStack Router ranks
the static `edit` segment correctly; no existing path changes.

### 6.5 `search/SearchBox.tsx`

The plain `<input>` becomes `<Input type="search" leadingIcon={Search}
hideLabel label={t('search.label')} placeholder={…} />`, at 36px rather
than 40 (`className="h-9"`) to sit in the sidebar. The `/` shortcut, the
debounce, `replace: true` and Escape-to-clear are unchanged; `Input`
forwards its ref, which the shortcut needs. The component's comment
explaining why it was a plain input is deleted.

### 6.6 `reporting/PeriodSummaryReport.tsx`

The two date inputs become `<Input type="date" label=… min/max=…>`. The
inverted-range message stays a `role="status"` paragraph — it describes
the pair, not either field, so it is not a field `error`.

## 7. File layout

```
apps/web/src/
  ui/
    Field.tsx              internal: label, hint, error, ids (new)
    Input.tsx              (new)
    Textarea.tsx           (new)
    Select.tsx             (new)
    Checkbox.tsx           (new)
    Button.tsx             + asChild
    index.ts               exports the four controls (not Field)
  clients/
    ClientListPage.tsx     restyled
    ClientListSkeleton.tsx (new)
    kindTone.ts            ClientKind -> BadgeTone (new)
    ClientForm.tsx         extracted form (new)
    ClientFormPage.tsx     create page, now thin
    ClientEditPage.tsx     edit page (new)
    ClientFormSkeleton.tsx the edit page's pending state (new)
    ClientDetailPage.tsx   header buttons only
  search/SearchBox.tsx     adopts Input
  reporting/PeriodSummaryReport.tsx   adopts Input
  router.tsx               + /clients/$clientId/edit
```

## 8. i18n

| Key | `pt-PT` | `en-GB` |
|---|---|---|
| `clients:editTitle` | Editar cliente | Edit client |
| `clients:count_one` | {{count}} cliente | {{count}} client |
| `clients:count_other` | {{count}} clientes | {{count}} clients |
| `clients:archived` | Arquivado | Archived |
| `clients:emptyHint` | Cria o primeiro cliente para começares a acompanhar prazos e avenças. | Create the first client to start tracking deadlines and fees. |
| `clients:noMatches` | Nenhum cliente corresponde aos filtros. | No clients match these filters. |
| `clients:noMatchesHint` | Tenta outro nome, o NIF, ou retira o filtro de tipo. | Try another name, the tax number, or clear the kind filter. |
| `clients:form.section.identification` | Identificação | Identification |
| `clients:form.section.contact` | Contacto | Contact |
| `clients:form.kind.immutable` | O tipo de cliente não pode ser alterado depois de criado. | A client's kind cannot change after it is created. |
| `clients:form.cannotClear` | Este campo ainda não pode ficar vazio. Indica um novo valor ou mantém o atual. | This field can't be emptied yet. Enter a new value or keep the current one. |
| `clients:form.profileLater` | O perfil fiscal preenche-se depois de criar o cliente. | The fiscal profile is filled in after the client is created. |

`clients:empty` changes copy in both locales from "No clients yet." to
a heading: "Ainda não há clientes" / "No clients yet" (no full stop —
it is now an `EmptyState` title). Every other label already has a key.
`pnpm --filter @ledger-hq/web i18n:check` must pass, and confirm it
accepts the `_one`/`_other` plural pair in both bundles.

## 9. Accessibility

Stage 1's checklist applies unchanged. Added for form controls, and
carried into the guidelines:

1. Every control has a programmatic label — visible, or visually hidden
   with `hideLabel`. A placeholder is never the label.
2. An error is announced (`role="alert"`), tied to its control by
   `aria-describedby`, and marked with `aria-invalid`; the border colour
   is never the only signal — the icon and text are always present.
3. Disabled means "cannot change", never "does not apply". Fields that
   do not apply are not rendered.
4. Controls are 40px tall; the filter bar's checkbox box matches, so
   the touch target is the whole box.
5. Focus order in the form follows reading order, section by section.

## 10. Testing

**New:**

- `ui/Input.test.tsx` — label names the control; `hideLabel` keeps the
  accessible name; `hint` and `error` are both in `aria-describedby`;
  `error` sets `aria-invalid` and renders a `role="alert"`; a caller's
  own `aria-describedby` survives; ref forwarding reaches the element.
- `ui/Select.test.tsx` — options render; `layout="inline"` keeps the
  label association; `error` as for `Input`.
- `ui/Checkbox.test.tsx` — clicking the label toggles; `description` is
  in `aria-describedby`.
- `ui/Textarea.test.tsx` — label and error, as for `Input`.
- `ui/Button.test.tsx` — `asChild` renders the child anchor with the
  button classes and no `type` attribute.
- `clients/ClientEditPage.test.tsx` — loads and pre-fills; kind is
  disabled; submitting sends only changed fields plus `kind`; emptying a
  previously-set email blocks the submit with the cannot-clear error;
  success navigates to the detail page.

**Updated:**

- `clients/ClientListPage.test.tsx` — pending renders the skeleton (the
  region is `aria-busy`); the unfiltered empty state has a Create link;
  a search with no matches shows the no-matches state without one; the
  count reads with the right plural; an archived row carries its badge.
- `clients/ClientFormPage.test.tsx` — field errors are still
  `role="alert"` and now also linked by `aria-describedby`; otherwise
  the existing cases stand.
- `clients/ClientDetailPage.test.tsx` — the Edit link exists and points
  at the edit route; it is absent for an archived client.
- `search/SearchBox.test.tsx`, `reporting/PeriodSummaryReport.test.tsx`
  — query by role and label already; they should pass unchanged, and
  any change is a semantic regression to look at, not to paper over.

**End-to-end:** the create form's submit now reads "Criar", and an
empty list has two Create links, so every spec that registers a client
through the UI (`setup-and-clients`, `obligations`, `billing`,
`search-and-reporting`, `vault-offline`) targets `/^criar$/i`, the
first link. `e2e/setup-and-clients.spec.ts` gains an edit journey —
create a client, open it, Edit, change the phone, save, see the new
phone on the detail page. At 390×844, the client list's rows show the
tax number under the name.

**Definition of done:** `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm --filter @ledger-hq/web i18n:check` and
`pnpm --filter @ledger-hq/web test:e2e` green; the Clients and New client
boards, and the newly drawn boards from §3, match the browser at
1280×800 and 390×844.

## 11. Risks

- **The control APIs are load-bearing.** Stages 3-5 put sixteen more
  forms on them. If an API proves wrong while restyling the client form
  — the honest test — change it here rather than working around it
  later. The `Field` split exists so that a change to label/hint/error
  behaviour is made once.
- **`Input` and the `/` shortcut.** The shortcut focuses the search box
  through a ref. `Input` must forward the ref to the `<input>`, not to
  its wrapper, or the shortcut silently stops working;
  `SearchBox.test.tsx` covers it.
- **Edit's diff.** Sending only changed fields keeps the request honest,
  but a bug in the diff could send nothing and "succeed". The edit test
  asserts the request body, not just the navigation.
- **Scope creep into Stage 3.** Once `Input` exists, restyling the
  detail page's forms is tempting. Only the header buttons move here.

## 12. Guidelines document

`docs/design/guidelines.md` gains a **Forms** section, written from what
shipped: the four controls and when to use each, the `Field` contract
(label, hint, error, ids), `hideLabel` versus a visible label, "disabled
means cannot change", `Select layout="inline"` for filters only,
`Button asChild` for a link that looks like a button, and §9's additions
to the accessibility checklist.
