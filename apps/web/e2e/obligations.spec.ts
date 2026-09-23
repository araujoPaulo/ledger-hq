import { expect, test } from '@playwright/test'

const MASTER_PASSWORD = 'a sufficiently long master password'

test('sets up a company, generates obligations, sees them on the dashboard, and adjusts one', async ({ page }) => {
  await page.goto('/')

  // First run: bootstrap the account. Bootstrap only ever succeeds once per
  // install (single-account app). `obligations.spec.ts` sorts alphabetically
  // before `setup-and-clients.spec.ts`, so when the full e2e suite runs all
  // spec files together at `workers: 1`, this file's worker deterministically
  // wins SetupPage's "confirm password" field first — but falling back to
  // sign-in when the confirm field never appears (same idiom as
  // `vault-offline.spec.ts`) keeps this spec correct standing alone too, e.g.
  // after a prior local run already created the account.
  await page.getByLabel(/email/i).fill('paulo@example.com')
  await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
  const confirmPasswordField = page.getByLabel(/confirma/i)
  if (await confirmPasswordField.isVisible().catch(() => false)) {
    await confirmPasswordField.fill(MASTER_PASSWORD)
  }
  await page.getByRole('button', { name: /criar|entrar/i }).click()
  await expect(page.getByRole('link', { name: /clientes/i })).toBeVisible()

  // Register a company client with an open, monthly-VAT fiscal profile.
  // Distinct name and NIF from `setup-and-clients.spec.ts`'s own company:
  // when the full suite runs all spec files together, both specs' clients
  // live in the same shared backend/DB, and a matching NIF would 409 on
  // `clients.tax_id_taken` (same reasoning `vault-offline.spec.ts` documents
  // for its own client).
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Padaria Central Obrigações, Lda.')
  await page.getByLabel(/^nif$/i).fill('501442626')
  await page.getByRole('button', { name: /guardar/i }).click()
  await expect(page.getByText('Padaria Central Obrigações, Lda.')).toBeVisible()

  await page.getByRole('button', { name: /guardar/i }).click() // saves the fiscal profile's own defaults, which already imply COMPANY/MONTHLY

  // The regenerate preview banner should appear once the profile exists.
  // MONTHLY VAT generates one instance per month across the generator's
  // [asOf - 3 months, asOf + 12 months] window (obligations.service.ts's
  // `floor`/`horizonEnd`), not just one for "today" — over a dozen "Declaração
  // periódica de IVA" rows appear at once, so `.first()` disambiguates
  // wherever the brief's original single-match assertion doesn't hold.
  await expect(page.getByRole('button', { name: /aplicar/i })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /aplicar/i }).click()
  await expect(page.getByText(/declaração periódica de iva/i).first()).toBeVisible()

  // The home dashboard now shows the same obligation, grouped by urgency.
  await page.goto('/')
  await expect(page.getByText(/declaração periódica de iva/i).first()).toBeVisible()
  await expect(page.getByText(/padaria central/i).first()).toBeVisible()

  // Marking it done removes it from the dashboard's pending view. With many
  // same-named rows (see above), asserting the text disappears entirely
  // would be wrong — only the one row is resolved; instead, the total count
  // of actionable rows drops by exactly one.
  const markDoneButtons = page.getByRole('button', { name: /marcar como feita/i })
  const pendingCountBeforeDone = await markDoneButtons.count()
  await markDoneButtons.first().click()
  await expect(markDoneButtons).toHaveCount(pendingCountBeforeDone - 1)

  // Back on the client page, adjust a different obligation's due date.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: 'Padaria Central Obrigações, Lda.' }).click()

  // Everything below is scoped to this section. The client page also carries
  // ClientLedgerSection, whose own "Editar"/"Guardar" controls render
  // immediately while this section is still waiting on its obligations
  // query — so a page-wide `.first()`/`.last()` resolves to the billing
  // form instead, depending on which query settles first.
  const obligations = page.getByRole('region', { name: /obrigações fiscais/i })
  await obligations.getByRole('button', { name: /^editar$/i }).first().click()
  // Two "Prazo" fields are on screen at once here: the just-opened
  // AdjustObligationForm and the always-rendered AddAdHocObligationForm at
  // the bottom of ObligationsSection (both use the same `form.dueDate`/
  // `adHoc.dueDate` "Prazo" label). AdjustObligationForm renders first.
  await obligations.getByLabel(/prazo/i).first().fill('2026-12-31')
  await obligations.getByRole('button', { name: /^guardar$/i }).click()
  // The saved row renders the date through `formatDate` (b0f5b17), so the
  // assertion is on the pt-PT rendering, not on the ISO value typed above.
  await expect(obligations.getByText('31/12/2026')).toBeVisible()
})
