# UI refresh, Stage 3 — design specification

**Date:** 2026-10-04
**Status:** approved
**Revised:** 2026-10-11 — folds in what writing the implementation plan
found: the `pt-PT` register and vocabulary (§9), the tab search param is
optional (§6.2), Stage 2's tone map is `KIND_TONE` (§6.3), `parseAmount`
validates grouping and accepts a pasted `€` (§5.5), `formatAmount` and
the `Euro` adornment (§5.5), `Callout` carries a `role` (§5.4), the
dialog's focus order and footer gap (§5.2), the toast region's label
(§5.3, §9), and Edit on an obligation row stays actionable-only (§7.2.1).
**Parent:** [UI refresh design](./2026-09-19-ui-refresh-design.md) ·
[roadmap](../../design/roadmap.md) ·
[Stage 1](./2026-09-24-ui-refresh-stage-1-design.md) ·
[Stage 2](./2026-10-04-ui-refresh-stage-2-design.md) ·
[screens](https://claude.ai/artifact/EYxudatoGJWQ4W7kf8iV92)

Stage 3 applies the design system to `ClientDetailPage` — the densest
screen in the app, composed from four features and seventeen components.
It introduces `Tabs`, `Dialog`, `Toast`, `Callout` and `MoneyInput`, and
settles the two questions the roadmap left open for this stage: which
forms become dialogs, and what the per-client obligation controls look
like once they have a tab to themselves.

## 1. Scope

**Ships:**

- Five components in `apps/web/src/ui/`: `Tabs`, `Dialog`, `Toast`,
  `Callout`, `MoneyInput`. `DataList` gains a description-list mode.
- `ClientDetailPage` rebuilt as a header plus five tabs — Overview,
  Obligations, Billing, People, Credentials — with the active tab in the
  URL.
- Every component composed into it restyled: `FiscalProfileForm`,
  `ObligationsSection`, `ObligationRow`, `AdjustObligationForm`,
  `AddAdHocObligationForm`, `ObligationAttachments`,
  `ClientLedgerSection`, `RetainerPlanForm`, `RecordPaymentForm`,
  `AddAdHocChargeForm`, `ApplyCreditForm`, `EmploymentSection`,
  `AddEmploymentForm`, `CredentialsSection`, `CredentialRow`,
  `AddCredentialForm`, `VaultUnlockGate`.
- Amounts are typed in euros, not cents, in all four forms that take one.
- New i18n keys (§9), both locales; the four "(cents)" labels lose the
  suffix.
- `docs/design/guidelines.md` extended.

**Does not ship:**

- The Vault page and vault setup (Stage 4), auth screens (Stage 5).
- Any API change. Tabs read the same endpoints the stacked sections read
  today; `MoneyInput` sends the same integer cents.
- New behaviour beyond presentation, with the exceptions §2 names.

## 2. Decisions

Settled by the mockups and the parent spec, not reopened here: five
tabs, header above the strip, horizontal scroll on mobile, one query
per tab; write-off is a `Dialog`; a revealed password is never shown,
only a mask plus Copy with the 30-second clear stated on screen;
the credentials section shows the gate or the list, never both.

Settled in this stage's brainstorming:

1. **A form becomes a `Dialog` when it is launched from a row, has more
   than one step, or creates something.** Concretely, every form on the
   page opens in a dialog from a button: write-off, adjust obligation,
   receipts, record payment, apply credit, retainer plan, fiscal
   profile, new charge, new obligation, add employment, new credential,
   change password. No form is permanently rendered on the page. Today
   four creation forms sit open under their lists at all times, which
   is most of why the page is long; a dialog per action is the pattern
   the mockups draw ("Record payment", "New charge" as header buttons).
2. **Amounts are typed in euros.** Four forms ask for "Amount (cents)",
   so €2,150.00 is typed as `215000`. `MoneyInput` accepts the locale's
   own notation and converts to cents before the value leaves the form.
   The wire format does not change.
3. **The active tab lives in the URL** as `?tab=`, validated by the
   route. A receivable on the Overview page links straight to its
   client's Billing tab, and a reload keeps the tab. Changing tabs uses
   `replace: true`: Back leaves the client rather than walking the tabs
   the reader clicked through.
4. **Overview fetches what its summary needs.** "Each tab keeps its own
   query" holds for Billing's plan, People, Credentials and the
   obligations preview. Overview's "At a glance" shows obligations due
   and the balance, so opening a client also fetches
   `['obligations', clientId]` and `['client-ledger', clientId]`. Those
   are the keys the Obligations and Billing tabs read, so switching to
   either is instant, and the Obligations tab's overdue count reads the
   same cache entry.
5. **No "Open" / "Settled" badges in the ledger.** The Billing board
   draws them, but `LedgerEntry` carries no paid state — only
   `writtenOff`. Inferring it from running balances would be a business
   rule in the UI. Only "Written off" gets a badge.
6. **Attachment deletion is confirmed inline**, inside the receipts
   dialog, not with `window.confirm` and not with a dialog on top of a
   dialog: the row's Delete becomes "Delete for good" (danger) plus
   Cancel.

## 3. Visual reference

| Artboard | What it fixes |
|---|---|
| Client detail — desktop (Billing tab) | header, tab strip, ledger, side cards |
| Client detail — mobile (Overview tab) | compact header, scrolling strip, details, fiscal profile, at a glance |
| Credentials — desktop | the gate (locked) and the list with one credential revealed, plus the copy toast |
| Credentials — mobile | the same, one column |

**Not drawn, and specified here in words:** Overview, Obligations and
People on desktop; Billing, Obligations, People and Credentials on
mobile; every dialog; the page and tab skeletons; the empty states.
Drawing them, desktop and mobile, is the implementation plan's first
task; the boards then outrank this section where they disagree.

**Where this spec overrides the boards:** the Credentials board's gate
says the vault stays open "for 15 minutes of inactivity"; the real
timeout is 5 minutes (`INACTIVITY_LOCK_MS` in `vault/vault-session.ts`)
and the copy interpolates it. The boards' ledger status badges are
dropped (§2.5). The boards' nav shows three items; the shell is correct.

## 4. Dependencies

| Package | Why |
|---|---|
| `@radix-ui/react-tabs` | roving tabindex, arrow keys, `tablist`/`tab`/`tabpanel` roles |
| `@radix-ui/react-dialog` | focus trap, Escape, scroll lock, `aria-modal`, focus return |
| `@radix-ui/react-toast` | live-region announcement, swipe to dismiss, pause on hover |

Peer ranges checked against React 19 at install, as before.

## 5. Components

Stage 1 and 2 conventions hold.

### 5.1 `Tabs`

Styled re-exports of Radix: `Tabs` (Root), `.List`, `.Trigger`,
`.Content`.

- `List`: `flex gap-1 border-b border-line`, `overflow-x-auto` with the
  scrollbar hidden, so the strip scrolls on mobile rather than wrapping.
- `Trigger`: `shrink-0 px-3.5 py-2.5 text-sm font-medium text-muted`,
  2px transparent bottom border; `data-[state=active]`: `text-accent-700
  font-semibold border-accent-600`. Children may include a `Badge` or an
  icon after the label.
- `Content`: no styling of its own; `forceMount` is not used, so an
  inactive panel is unmounted and its queries do not run.
- Root is always controlled (`value` / `onValueChange`) in this app; the
  component does not prevent uncontrolled use.

### 5.2 `Dialog`

```ts
Dialog            // Radix Root: open, onOpenChange
Dialog.Trigger    // asChild-friendly
Dialog.Content    // props: title: string; description?: string; size?: 'sm' | 'md' (default 'md')
Dialog.Footer     // right-aligned action row
Dialog.Close      // asChild-friendly
```

- Overlay `bg-ink/40`. Content `bg-surface rounded-surface
  shadow-overlay`, `max-w-sm` (`sm`) or `max-w-lg` (`md`), `p-6`,
  centred, `max-h-[90dvh] overflow-y-auto`, `mx-4` on mobile.
- `title` renders as Radix `Dialog.Title` (an `<h2>`, `text-lg
  font-semibold`); `description` as `Dialog.Description`
  (`text-sm text-muted`). Both are required by Radix for the accessible
  name and description; making `title` a required string prop means it
  cannot be forgotten.
- A close icon button (`X`, `aria-label` from `common:actions.close`)
  sits top-right. It is positioned absolutely but comes **after** the
  children in the DOM, so Radix's open autofocus lands on the first
  field, not on Close.
- `Footer`: `flex justify-end gap-4 pt-2` (the guidelines' control-group
  gap); on mobile the buttons stretch full width and stack, primary
  first.
- **Forms inside a dialog** render their own `<form>` wrapping the
  fields and a `Dialog.Footer` with Cancel (`Dialog.Close asChild` +
  `Button variant="ghost"`) and the submit. The form's former `<h3>`
  is deleted — the dialog title replaces it.
- Open state is controlled by the section that owns the trigger, so a
  successful submit closes the dialog by setting it false. A failed
  submit keeps it open with `ErrorMessage` inside.

### 5.3 `Toast`

```ts
<ToastProvider>          // mounted once in AppLayout
const { toast } = useToast()
toast({ title: string; tone?: 'neutral' | 'success' })   // default 'neutral'
```

- One Radix `Toast.Provider` and `Toast.Viewport` in `AppLayout`;
  `useToast` reads a context that holds a short queue, and throws when
  called outside the provider (a missing provider is a wiring bug, not a
  silent no-op). The provider passes `label={t('common:notifications')}`
  so the viewport's landmark name is translated rather than Radix's
  English default.
- Viewport bottom-right on desktop; bottom-centre on mobile, lifted
  above the tab bar (`bottom-[calc(5rem+env(safe-area-inset-bottom))]`).
- `bg-ink text-white rounded-surface shadow-overlay px-4 py-3 text-sm`,
  a leading icon (`Check` for success, `Info` otherwise), 4 seconds,
  pauses on hover and focus. Radix announces it politely.
- Used only for confirmations of things with no other visible result —
  in this stage, copying to the clipboard. A dialog that closes and a
  list that updates is its own confirmation; toasting it as well is
  noise.

### 5.4 `Callout`

```ts
type CalloutProps = {
  tone?: 'neutral' | 'warning' | 'danger'   // default 'neutral'
  icon?: LucideIcon
  title?: string
  children: ReactNode
  action?: ReactNode
  role?: 'status' | 'alert'                 // e.g. the gate's offline message keeps role="status"
}
```

A flat, bordered block: `-50` tint, `border` in the tone's `-700` at
20% opacity, `rounded-surface p-4`, icon and text in the `-700` shade,
action right-aligned (below on mobile). For a message about a section's
state that is neither an error nor empty: the generator preview, the
vault not set up, the vault unknown offline. Stage 4's recovery-code
warning is its fourth consumer. Not a toast (it persists) and not an
`EmptyState` (there may be content below it).

### 5.5 `MoneyInput`

```ts
type MoneyInputProps = Omit<InputProps, 'type' | 'value' | 'defaultValue' | 'onChange' | 'inputMode'> & {
  defaultCents?: number | null
  onValueChange: (cents: number | null) => void
}
```

- An `Input` with `inputMode="decimal"` and `leadingIcon={Euro}` — the
  `lucide-react` euro sign, which fits Stage 2's
  `leadingIcon?: LucideIcon` without widening that API.
- The text is the component's own state; the parent receives cents on
  every change, or `null` when the text is empty or not a valid amount.
  A form resets it after success by changing its `key`.
- Parsing is a pure function beside `formatCurrency` in
  `src/i18n/format.ts`, so the one file that turns cents into text also
  turns text into cents:

  ```ts
  export function parseAmount(text: string, locale: SupportedLocale): number | null
  ```

  - The locale's decimal separator is the only decimal mark (`,` for
    `pt-PT`, `.` for `en-GB`). Whitespace (including the narrow no-break
    space `Intl` groups with) and a leading or trailing `€` are
    stripped, so an amount copied from the app's own display parses.
  - The other separator (`.` for `pt-PT`, `,` for `en-GB`) is accepted
    only as a thousands separator between groups of exactly three
    digits. `"2.150"` is 215000 in `pt-PT`, but `"2150.50"` is `null`,
    not 21,505,000 cents: a decimal typed with the wrong mark is
    refused rather than read as a hundredfold amount.
  - At most two decimal places; no sign; no letters. `"2150"`,
    `"2150,5"`, `"2.150,00"` → 215000, 215050, 215000 in `pt-PT`;
    `"2,150.00"` → 215000 in `en-GB`. `"2.150"` in `en-GB` is three
    decimals and therefore `null`.
  - Returns integer cents computed without floating-point arithmetic
    (split on the decimal mark, pad, join, `parseInt`), or `null` past
    `Number.MAX_SAFE_INTEGER`.
- `formatAmount(cents, locale)` sits beside it: the locale's own grouped
  form, two decimals, no symbol.
- On blur, a valid value is rewritten through `formatAmount` — `2 150,00`
  in `pt-PT` (Intl groups with a narrow space there, not a dot) and
  `2,150.00` in `en-GB`; an invalid one shows
  `error={t('common:money.invalid')}` — until then, typing is never
  interrupted. Blur does not call `onValueChange` (the cents have not
  changed), so it never retracts a payment proposal.
- Whether an amount must be positive is the form's rule, not the
  component's; the four forms below all require `> 0` and disable submit
  otherwise.

### 5.6 `DataList` — description-list mode

Stage 1 deferred this to here. `DataList` gains `as?: 'div' | 'dl'`
(default `'div'`). With `'dl'`, rows render `<div><dt/><dd/></div>` (valid
inside `<dl>` since HTML 5.2) and the label slot is `text-muted`. Used
for the client's details, the fiscal profile, the retainer plan and a
revealed credential — genuine name/value descriptions, none with an
interactive label. Lists of records (ledger, employments) stay `div`.

## 6. The page

### 6.1 Structure

```
clients/
  ClientDetailPage.tsx       loads the client; header + tabs
  ClientDetailSkeleton.tsx   (new)
  ClientHeader.tsx           (new) name, meta line, actions
  clientTabs.ts              (new) tab ids, search validation, tab → label key
  ClientOverviewTab.tsx      (new) details, fiscal profile, at a glance
  FiscalProfileCard.tsx      (new) read view + dialog
  FiscalProfileForm.tsx      restyled, rendered in the dialog
```

Each other tab renders the feature's existing section component —
`ObligationsSection`, `ClientLedgerSection`, `EmploymentSection`,
`CredentialsSection` — restyled in place. Their props do not change.

### 6.2 Route

`/clients/$clientId` gains `validateSearch`:

```ts
validateSearch: (search: Record<string, unknown>): { tab?: ClientTab } =>
  isClientTab(search.tab) ? { tab: search.tab } : {}
```

`CLIENT_TABS = ['overview', 'obligations', 'billing', 'people',
'credentials'] as const`. The key is optional and an absent or unknown
value means Overview — a required key would make every typed `Link` to a
client pass `search`. Every `Link` that does not care about the tab
passes nothing. Choosing Overview navigates with `search: {}`, so the
default tab keeps a clean URL. Stage 2's
edit page links back with no tab (lands on Overview).
`ReceivablesSection`'s client link adds `search={{ tab: 'billing' }}` —
the one link that knows where its reader wants to go.

### 6.3 Header — `ClientHeader.tsx`

- A back link to `/clients` above the title (`ChevronLeft` +
  `clients:title`), `text-xs font-medium`.
- `<h1>` the client name, `text-2xl font-semibold`. Not a `PageHeader`:
  the meta line is richer than a description string. It still owns the
  page's only `<h1>`.
- Meta line, `text-xs text-muted`, wrapping: kind `Badge` (Stage 2's
  `KIND_TONE`, `clients/kindTone.ts`), tax number `tabular-nums`, then legal form and
  accounting joined by " · ". An archived client adds
  `<Badge tone="neutral">{t('clients:archived')}</Badge>`.
- Actions, `hidden md:flex`: Archive/Restore and Edit (from Stage 2),
  both `secondary`. Below `md`, a single icon `Button` (`MoreHorizontal`,
  `aria-label={t('clients:actions')}`) opens a `DropdownMenu` with the
  same two items.
- Archive/restore errors render under the header with `ErrorMessage`,
  as now.

### 6.4 Tab strip

`Tabs value={tab} onValueChange={(next) => navigate({ search: { tab:
next }, replace: true })}`. Labels `clients:tabs.*`. Adornments:

- Obligations: a `Badge tone="danger"` with the overdue count, only when
  `['obligations', clientId]` is in the cache and the count is above
  zero (it always is after Overview mounts; it is never fetched for the
  badge alone).
- Credentials: a `Lock` icon (`aria-hidden`, `text-subtle`) while the
  vault is locked.
- People: labelled `employments:employeesTitle` for a company and
  `employments:employmentsTitle` for an individual — the section's own
  wording — rather than a new generic "People" key. The mockups' "People"
  is the English board's shorthand.

### 6.5 Loading, error, archived

- `client.isPending` renders `ClientDetailSkeleton` (header block, tab
  strip, two card blocks), replacing today's `return null`.
- `client.isError` renders `ErrorMessage`, as now.
- Archived clients show every tab read-only in effect only where the
  server refuses writes; the UI does not pre-empt those rules.

## 7. Tabs

### 7.1 Overview — `ClientOverviewTab.tsx`

Desktop: `grid lg:grid-cols-[1fr_320px] gap-6`, left column Details then
Fiscal profile, right column At a glance. Mobile: one column, in the
order the mobile board draws — Details, Fiscal profile, At a glance.

- **Details** (`Card`, `<h2>` `clients:details`): `DataList as="dl"` —
  tax number, accounting, legal form, social security number, date of
  birth, email, phone — each only when non-null, as today. Email is a
  `mailto:` link and phone a `tel:` link. Notes, when present, render
  under the list as prose (weight 400), not as a row: a paragraph does
  not fit a value slot.
- **Fiscal profile** — `FiscalProfileCard.tsx`, `Card` with `<h2>`
  `clients:profile.title`:
  - Loaded: `DataList as="dl"` — VAT regime, income tax, start date —
    and below it the four flags as `Badge`s, each with a `Check` icon
    when true and absent when false (a list of four "No"s says
    nothing). An `Edit` button (`secondary`, `sm`) in the card header
    opens a `Dialog` titled `clients:profile.title` holding
    `FiscalProfileForm`.
  - Missing (the expected 404, `common.not_found`): the card body is
    `clients:profile.empty` and the header button reads
    `clients:profile.setUp`; it opens the same dialog with the
    kind's defaults.
  - Failed for any other reason: `ErrorMessage`, and no button — the
    existing guard against overwriting a profile that merely failed to
    load stays, and its comment moves with it.
  - Pending: `Skeleton` rows inside the card.
- **`FiscalProfileForm`** in the dialog: two `Select`s, a date `Input`,
  four `Checkbox`es (the company's "open activity" disabled with
  `description={t('clients:profile.openActivityCompany')}` — here
  disabled is right: it applies and cannot change). Consistency
  violations render as a `Callout tone="danger"` listing each, above
  the footer, replacing the stack of red paragraphs. Saving closes the
  dialog; the invalidations are unchanged.
- **At a glance** (`Card`, `<h2>` `clients:glance.title`): two tiles,
  each a `Link` to its tab, each a 44px+ target:
  - Obligations due — count of overdue plus this-week obligations via
    `groupByUrgency(data, new Date())`, the function the dashboard and
    `SummaryRow` already use; danger text when any are overdue.
  - Balance — `<Money cents={ledger.balanceCents} size="lg" />`.
  - Each tile shows a `Skeleton` while its query is pending.

### 7.2 Obligations — `ObligationsSection.tsx`

- Section header: `<h2>` `obligations:section.title` and a `primary sm`
  button `obligations:adHoc.newTitle` opening the new-obligation dialog.
- **Generator preview**: when the dry run proposes changes, a
  `Callout tone="warning" icon={RefreshCw}` with the existing
  `section.previewMessage` and `<Button size="sm" variant="primary"
  isLoading={apply.isPending}>` Apply as its action. Logic unchanged,
  including setting the preview cache to empty after applying.
- **List**: rows are `ObligationRow`, restyled (§7.2.1). While pending,
  `ObligationsSectionSkeleton`; empty, `EmptyState icon={CalendarCheck}`
  with `section.empty` and the new `section.emptyHint`.
- **Adjust** opens a `Dialog` titled with the obligation's name and
  period, holding `AdjustObligationForm`: due date `Input`, status
  `Select`, notes `Textarea`. "Waived needs a reason" becomes the notes
  field's `error`, shown once the status is Waived and notes are empty.
  The always-send-notes-when-waiving rule and its comment stay.
- **New obligation** dialog: `AddAdHocObligationForm` — code, name,
  periodicity `Select`, period label, due date. Fields as today.
- **Receipts** open a `Dialog` titled `attachments.title` — obligation
  name, holding `ObligationAttachments` restyled:
  - File rows: a `DataList` — label the filename as a download link,
    value the size and date (`text-xs text-muted tabular-nums`) and a
    `ghost sm` Delete. Delete swaps in place for
    `Button variant="danger" size="sm"` `attachments.confirmDeleteAction`
    plus a `ghost` Cancel (§2.6); `window.confirm` and the
    `confirmDelete` key go away.
  - Upload: the file `<input>` becomes visually hidden behind a `label`
    styled as a `secondary` button with a `Paperclip` icon
    (`attachments.add`). The client-side size check, the hint and the
    uploading state stay; uploading renders the button label with a
    spinner.
  - Empty: a plain `text-sm text-muted` line — an `EmptyState` inside a
    dialog is too heavy.

#### 7.2.1 `ObligationRow`

Stage 1 left the row untouched for this stage. It is shared with the
dashboard (`showClient`, mark-done only), so the restyle shows on the
Overview page too; it keeps drawing its own surface, as the guidelines
say.

- `rounded-surface border border-line bg-surface px-4 py-3`, a flex row
  that wraps on mobile.
- Left: the name (`font-medium`; with `showClient`, the client name
  first, as now), and under it the period in `text-xs text-muted`
  through `formatQuarter` when it is a quarter label, raw otherwise.
- Due date, `text-sm tabular-nums`, in `text-danger-700` when overdue.
  A `dueDateOverridden` date gets a small `PencilLine` icon with a
  visually hidden `obligations:row.overridden`.
- Status `Badge` only when the status is not `PENDING`, toned through a
  new `obligations/statusTone.ts` (`IN_PROGRESS` accent, `DONE`
  success, `WAIVED` neutral).
- Actions: `secondary sm` "Mark as done" (when actionable), `ghost sm`
  "Edit" (when actionable and `onEdit` — as today, a done or waived
  obligation is not adjusted from its row), `ghost sm` with `Paperclip`
  "Receipts" (when `onManageAttachments`). Today's underlined text buttons go away.
- On the dashboard, the actions group is just Mark as done, as now.

### 7.3 Billing — `ClientLedgerSection.tsx`

Desktop `grid lg:grid-cols-[1fr_320px] gap-6`; mobile, the ledger first
and the cards below.

- **Ledger card**: `<h2>` `billing:ledger.title`; header actions
  `primary sm` `billing:payment.recordTitle` and `secondary sm`
  `billing:adHocCharge.newTitle`, each opening its dialog.
  - Rows: `DataList`. Label: the date (`text-xs text-muted tabular-nums`,
    fixed width on desktop, above the description on mobile) and the
    description. Value: a `Badge tone="neutral" strikethrough`
    `billing:writeOff.badge` when written off; a `danger sm` "Write off"
    button on a live charge (`type === 'CHARGE' && chargeId !== null &&
    !writtenOff`); and `<Money>` — `tone="writtenOff"` when written off,
    otherwise `auto`, so a payment's negative amount reads as a credit.
  - `DataList.Total` with `billing:ledger.balance` and the balance as
    `Money`. Replaces the hand-built footer.
  - Pending: `ClientLedgerSkeleton`; empty: `EmptyState icon={Receipt}`
    with `ledger.empty` and the new `ledger.emptyHint`.
- **Write-off dialog** (`size="sm"`), titled `billing:writeOff.title`:
  the charge's description and `Money` as a read-only line, a required
  `Textarea` `writeOff.reason.label`, footer Cancel and
  `Button variant="danger"` `writeOff.action`, disabled until the reason
  is non-blank. The inline input and the `writingOffChargeId` row state
  go; the dialog holds the charge being written off.
- **Retainer plan card**: `<h2>` `billing:retainerPlan.title`;
  `DataList as="dl"` — amount (`Money`), periodicity, due day, in force
  from. Header button "Update fee" (`retainerPlan.renewTitle`) when a
  plan exists, "Create retainer plan" when it does not; either opens the
  dialog holding `RetainerPlanForm` with `MoneyInput`. No plan: the body
  is `retainerPlan.none`. Replaces the "Edit" toggle.
- **Ageing card**: the client's row from the `['receivables']` query,
  found by `clientId` (no new endpoint, and the cache entry is usually
  warm from the Overview page). `Badge` from `AGEING_TONE`, the
  outstanding amount as `Money size="lg"`, and
  `billing:ageing.oldest` with the `oldestDueOn` date. No row: the card
  is not rendered — a settled client has no ageing.
- **Credit card**: only when `availableCreditCents > 0`, as today.
  `billing:credit.title`, the amount as `<Money tone="credit">`, the
  hint, and a `secondary sm` "Apply credit". The button runs the
  propose mutation and opens a dialog with the result: the proposed
  allocations as a `DataList` (description · due date, `Money`), the
  leftover line, Confirm. "Nothing to apply" renders inside the dialog
  with only a Close.
- **Record payment dialog**: `MoneyInput` amount, received-on date
  `Input`, method `Select`. Step one, "Propose allocation"; the proposal
  then renders inside the same dialog as a `DataList` plus the excess
  line, and the footer's primary becomes Confirm. Editing the amount or
  date after proposing still retracts the proposal (the comment stays).
- **New charge dialog**: description `Input`, `MoneyInput`, due date
  `Input`.
- Every success path keeps today's invalidations (`client-ledger`,
  `receivables`, `current-retainer-plan`).

### 7.4 People — `EmploymentSection.tsx`

- `<h2>` with the kind's title; `primary sm` `employments:add` opens the
  dialog holding `AddEmploymentForm` (counterparty `Select`, dates,
  job title — its schema handling unchanged).
- Rows: `DataList`. Label: the counterparty as a `Link` to their client
  page, the job title below in `text-xs text-muted`. Value: the period
  (`tabular-nums`), and for an open spell a `Badge tone="success"`
  `employments:current` and a `secondary sm` `employments:end`.
- Pending: skeleton rows; empty: `EmptyState icon={Users}` with
  `employments:empty` and the new `employments:emptyHint`.

### 7.5 Credentials — `CredentialsSection.tsx`

**Locked — `VaultUnlockGate.tsx`.** A `Card` centred at `max-w-md`:

- A 48px `bg-ground` circle with a `Lock` icon, the title
  `vault:unlock.lockedTitle`, and `vault:unlock.lockedHint` with the
  timeout interpolated in minutes from `INACTIVITY_LOCK_MS` (exported
  for this).
- The master password `Input` (`autoComplete="current-password"`) with
  the wrong-password message as its `error`, and `Button
  variant="primary" type="submit" isLoading={pending}` Unlock.
- Not set up: `Callout tone="neutral" icon={ShieldAlert}` with
  `unlock.notSetUp` and a `Button asChild` link to `/vault/setup`.
- Unknown offline: `Callout tone="warning" icon={WifiOff}
  role="status"` with `unlock.offlineUnknown`.
- The three error branches and their comments are unchanged.

**Unlocked.** Header: `<h2>` `vault:credentials.title`, then a `ghost
sm` "Lock vault" with a `Lock` icon (`common:actions.lockVault`, the
account menu's own action, closer to where the secrets are) and a
`primary sm` `credentials.newTitle` opening the dialog holding
`AddCredentialForm` (platform `Select`, label, username, password
`type="password"`, TOTP secret `font-mono`).

**Rows — `CredentialRow.tsx`.** A `Card padding="none"` list:

- Collapsed: a platform avatar (initials of the platform name in a
  32px `bg-accent-50 text-accent-700 rounded-control` square —
  `vault/PlatformAvatar.tsx`, which Stage 4's vault page reuses), the
  platform name and label, `credentials.changed` with
  `formatDate(updatedAt)` in `text-xs text-muted`, and a `secondary sm`
  Reveal.
- Revealed: the row expands into a `DataList as="dl"`:
  - Username, with a `ghost icon` copy button
    (`aria-label={t('vault:credentials.copyUsername')}`) — a plain copy,
    no clearing (a username is not a secret), and a toast
    `credentials.usernameCopied`.
  - Password: the mask, a `secondary sm` Copy (`credentials.copy`), and
    `credentials.clipboardClears` in `text-xs text-muted` beside it, so
    the 30-second clear is stated where it happens. Copy runs today's
    `copyAndClear` and toasts `credentials.passwordCopied` (success).
  - Current code: the TOTP in `font-mono text-lg tabular-nums`, grouped
    3+3, with `credentials.secondsLeft` — the seconds remaining in the
    30-second step, from the same one-second tick that refreshes the
    code.
  - Notes, as prose.
  - A `ghost sm` `credentials.rotate` opening a `size="sm"` dialog
    with the new password `Input` and Confirm — replacing the inline
    input.
- Hide collapses the row. The rule that locking clears revealed
  plaintext, and its effect, are unchanged.
- Pending: skeleton rows; empty: `EmptyState icon={KeyRound}` with
  `credentials.empty` and the "New credential" button as action.

## 8. File layout

```
apps/web/src/
  ui/
    Tabs.tsx  Dialog.tsx  Toast.tsx  Callout.tsx  MoneyInput.tsx   (new)
    DataList.tsx                   + as="dl"
    index.ts                       exports all five
  i18n/format.ts                   + parseAmount
  shell/AppLayout.tsx              + ToastProvider
  router.tsx                       /clients/$clientId validateSearch
  clients/                         §6.1
  obligations/
    ObligationsSection.tsx  ObligationsSectionSkeleton.tsx (new)
    ObligationRow.tsx  statusTone.ts (new)
    AdjustObligationForm.tsx  AddAdHocObligationForm.tsx  ObligationAttachments.tsx
  billing/
    ClientLedgerSection.tsx  ClientLedgerSkeleton.tsx (new)
    WriteOffDialog.tsx (new)  RetainerPlanCard.tsx (new)  AgeingCard.tsx (new)  CreditCard.tsx (new)
    RetainerPlanForm.tsx  RecordPaymentForm.tsx  AddAdHocChargeForm.tsx  ApplyCreditForm.tsx
    ReceivablesSection.tsx         link gains ?tab=billing
  employments/EmploymentSection.tsx  AddEmploymentForm.tsx
  vault/
    CredentialsSection.tsx  CredentialRow.tsx  AddCredentialForm.tsx  VaultUnlockGate.tsx
    PlatformAvatar.tsx (new)
    vault-session.ts               exports INACTIVITY_LOCK_MS
```

`ClientLedgerSection` is the file most at risk of growing past
readability: three cards and four dialogs. Each card is its own file;
the section composes them.

## 9. i18n

New keys, both locales:

| Key | `pt-PT` | `en-GB` |
|---|---|---|
| `common:actions.close` | Fechar | Close |
| `common:money.invalid` | Indica um valor como 2150,00. | Enter an amount such as 2,150.00. |
| `common:notifications` | Notificações | Notifications |
| `clients:actions` | Ações do cliente | Client actions |
| `clients:details` | Dados | Details |
| `clients:tabs.overview` | Resumo | Overview |
| `clients:tabs.obligations` | Obrigações | Obligations |
| `clients:tabs.billing` | Faturação | Billing |
| `clients:tabs.credentials` | Credenciais | Credentials |
| `clients:glance.title` | Num relance | At a glance |
| `clients:glance.due` | Obrigações a vencer | Obligations due |
| `clients:glance.balance` | Saldo | Balance |
| `clients:profile.empty` | Ainda não há perfil fiscal. Sem ele, o gerador não propõe obrigações. | No fiscal profile yet. Without one, the generator proposes no obligations. |
| `clients:profile.setUp` | Preencher | Set up |
| `clients:profile.openActivityCompany` | Uma empresa tem sempre atividade aberta. | A company always has open activity. |
| `obligations:section.emptyHint` | Preenche o perfil fiscal e o gerador propõe as obrigações deste cliente. | Fill in the fiscal profile and the generator proposes this client's obligations. |
| `obligations:row.overridden` | Data alterada manualmente | Date changed by hand |
| `obligations:attachments.confirmDeleteAction` | Apagar definitivamente | Delete for good |
| `billing:ledger.emptyHint` | As avenças e cobranças aparecem aqui quando são emitidas. | Fees and charges appear here once they are issued. |
| `billing:writeOff.title` | Anular cobrança | Write off charge |
| `billing:writeOff.badge` | Anulada | Written off |
| `billing:retainerPlan.title` | Avença | Retainer plan |
| `billing:retainerPlan.none` | Sem avença em vigor. | No retainer plan in force. |
| `billing:ageing.title` | Antiguidade | Ageing |
| `billing:ageing.oldest` | Cobrança por pagar mais antiga vence a {{date}}. | Oldest unpaid charge fell due on {{date}}. |
| `employments:emptyHint` | Regista quem trabalha para quem, para as obrigações de pessoal. | Record who works for whom, for the payroll obligations. |
| `vault:unlock.lockedTitle` | O cofre está bloqueado | This vault is locked |
| `vault:unlock.lockedHint` | As credenciais só são decifradas neste dispositivo. O cofre volta a bloquear após {{minutes}} minutos de inatividade. | Credentials are decrypted on this device only. The vault locks again after {{minutes}} minutes of inactivity. |
| `vault:credentials.changed` | Alterada a {{date}} | Changed {{date}} |
| `vault:credentials.copyUsername` | Copiar utilizador | Copy username |
| `vault:credentials.usernameCopied` | Utilizador copiado. | Username copied. |
| `vault:credentials.passwordCopied` | Palavra-passe copiada. A área de transferência limpa-se em 30 segundos. | Password copied. The clipboard clears in 30 seconds. |
| `vault:credentials.clipboardClears` | Limpa ao fim de 30 s | Clears after 30 s |
| `vault:credentials.secondsLeft` | {{seconds}} s restantes | {{seconds}} s left |

`pt-PT` copy follows the bundle: *tu*, never the formal register, and
*bloquear/desbloquear* for the vault (the bundle's "Bloquear cofre",
"Desbloquear"), never *trancar*.

Copy changes, both locales: `billing:retainerPlan.amountCents.label`,
`newAmountCents.label`, `payment.amountCents.label` and
`adHocCharge.amountCents.label` drop "(cents)"/"(cêntimos)" — "Valor
mensal" / "Monthly amount", "Novo valor" / "New amount", "Valor" /
"Amount", "Valor" / "Amount". Keys
removed with their last reference: `obligations:attachments.confirmDelete`,
`obligations:attachments.close` (the dialog's close replaces it).
Run `i18n:check`.

The tab badge's count and the at-a-glance tile render numbers only;
no new plural keys.

## 10. Accessibility

Added to the checklist:

1. Tabs: arrow keys move between triggers, Home/End jump, the active
   panel is `aria-labelledby` its trigger (Radix). A badge inside a
   trigger is part of its name, so the count is read with it.
2. Dialogs: focus moves to the first field on open, is trapped, and
   returns to the trigger on close; Escape closes; every dialog has a
   title. A dialog never opens another dialog.
3. A toast never carries the only copy of information; it confirms an
   action whose result is otherwise invisible.
4. The TOTP countdown is not a live region — announcing every second
   would make the page unusable with a screen reader. The code itself
   is plain text that a reader reaches when they want it.
5. `MoneyInput`'s format error is announced like any field error and
   only on blur, never mid-typing.

## 11. Testing

**New:**

- `i18n/format.test.ts` — `parseAmount` for both locales: integers,
  one and two decimals, grouped, a misplaced grouping separator, too
  many decimals, letters, signs, empty, whitespace; and a round trip
  with `formatCurrency` and with `formatAmount` for a spread of
  amounts.
- `ui/MoneyInput.test.tsx` — emits cents while typing, `null` for
  invalid; error only after blur; reformats on blur; `defaultCents`
  pre-fills in the active locale.
- `ui/Dialog.test.tsx` — title names the dialog; Escape closes and focus
  returns to the trigger; the close button has its label.
- `ui/Tabs.test.tsx` — arrow-key navigation; only the active panel is
  mounted.
- `ui/Toast.test.tsx` — `toast()` renders the title in a status region
  and it disappears after the duration (fake timers).
- `ui/Callout.test.tsx` — renders title, body and action; icon
  `aria-hidden`.
- `ui/DataList.test.tsx` — `as="dl"` renders `dt`/`dd`.

**Updated** (the semantic changes the restyle makes, not styling):

- `clients/ClientDetailPage.test.tsx` — tabs: Overview is default;
  `?tab=billing` opens Billing; clicking a tab updates the URL; the
  pending state renders the skeleton; the mobile actions menu holds Edit
  and Archive.
- `clients/FiscalProfileForm.test.tsx` — opened through the card's
  button; violations render in the callout; the failed-load guard still
  offers no form.
- `obligations/ObligationsSection.test.tsx`,
  `ObligationAttachments.test.tsx`, `ObligationRow.test.tsx` — adjust
  and receipts open dialogs; deletion is the inline two-step, with no
  `window.confirm` spy; the row's actions are buttons by role and name.
- `billing/ClientLedgerSection.test.tsx` — write-off through the dialog
  with the reason required; record payment typed in euros posts cents
  (type "2150,00" in `pt-PT`, assert `amountCents: 215000` in the body);
  the plan card's button opens the plan dialog; the ageing card appears
  only with a receivables row.
- `billing/ReceivablesSection.test.tsx` — the client link carries
  `?tab=billing`.
- `employments/EmploymentSection.test.tsx`,
  `vault/CredentialsSection.test.tsx`, `vault/VaultUnlockGate.test.tsx`
  — add dialogs open from their buttons; copy shows the toast; the gate's
  wrong password is the field's error; the hint states 5 minutes.
- `HomePage.test.tsx`, `obligations/ObligationsDashboard.test.tsx` —
  must pass unchanged after the `ObligationRow` restyle.

**End-to-end:** `e2e/billing.spec.ts` records a payment typed in euros
and sees the balance; `e2e/obligations.spec.ts` opens the Obligations tab
and adjusts an obligation through the dialog; `e2e/vault-offline.spec.ts`
reaches credentials through the Credentials tab. Mobile viewport: the
tab strip scrolls and the actions menu opens.

**Definition of done:** the full suite, `i18n:check` and e2e green; the
four boards and the newly drawn ones match the browser at 1280×800 and
390×844.

## 12. Risks

- **Size.** Seventeen components restyled and five new ones is the
  largest stage by far. The plan should land it as a sequence of
  self-contained commits — components, then the page shell and tabs,
  then one tab at a time — each leaving the suite green, so a review
  can follow it and a regression can be bisected.
- **Tests that query by visible form.** Several section tests find a
  form's inputs directly on the page. Behind a dialog they must click
  the trigger first. That is a semantic change, expected and fine; a
  test that starts failing for any other reason is a regression.
- **`MoneyInput` and existing data entry habits.** Anyone used to typing
  cents will type `215000` and get €215,000.00. The amount is shown
  back formatted on blur and in the payment proposal before Confirm, and
  the labels no longer say "cents"; that is the mitigation.
- **The `ObligationRow` change reaches the Overview page.** Stage 1's
  boards for Overview predate it; update the Overview loaded board in
  the same drawing pass so the two stay consistent.
- **Toast provider placement.** `ToastProvider` lives in `AppLayout`;
  Stage 5 moves auth screens outside the shell, and nothing there
  toasts. If a future auth flow needs one, the provider moves up to
  `main.tsx` then.

## 13. Guidelines document

`docs/design/guidelines.md` gains: **Dialogs** (§2.1's rule for when a
form becomes one; one dialog at a time; forms own their footer),
**Tabs** (URL-backed, `replace` navigation, inactive panels unmounted),
**Toasts** (only for otherwise invisible results), **Callouts** versus
`EmptyState` versus `ErrorMessage`, **Amounts** (`MoneyInput` in,
`Money` out, `parseAmount`/`formatCurrency` as the only conversions),
and §10's additions to the checklist.
