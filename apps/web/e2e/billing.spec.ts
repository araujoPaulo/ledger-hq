import { expect, test } from '@playwright/test'

const MASTER_PASSWORD = 'a sufficiently long master password'

test('creates a retainer plan, charges a client, records a payment, and sees the client clear from receivables', async ({ page }) => {
  await page.goto('/')

  // Bootstrap-or-sign-in fallback, same idiom as every other spec in this
  // suite (see obligations.spec.ts's own comment for why this can't assume
  // it always wins the single-account bootstrap race).
  await page.getByLabel(/email/i).fill('paulo@example.com')
  await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
  const confirmPasswordField = page.getByLabel(/confirma/i)
  if (await confirmPasswordField.isVisible().catch(() => false)) {
    await confirmPasswordField.fill(MASTER_PASSWORD)
  }
  await page.getByRole('button', { name: /criar|entrar/i }).click()
  await expect(page.getByRole('link', { name: /clientes/i })).toBeVisible()

  // A distinct name and NIF from every other spec's own client, to avoid a
  // 409 on `clients.tax_id_taken` when the full suite runs together against
  // the one shared backend.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Padaria Central Faturação, Lda.')
  await page.getByLabel(/^nif$/i).fill('501442634')
  await page.getByRole('button', { name: /guardar/i }).click()
  await expect(page.getByText('Padaria Central Faturação, Lda.')).toBeVisible()
  await page.getByRole('button', { name: /guardar/i }).click() // fiscal profile defaults

  // Every locator below is scoped to the region or form it belongs to.
  // ClientLedgerSection deliberately renders three forms whose labels
  // overlap ("Valor (cêntimos)" is in both RecordPaymentForm and
  // AddAdHocChargeForm), and ClientDetailPage's own outer <section> wraps
  // all of them — so an unscoped locator here resolves ambiguously, which
  // is exactly the class of collision Phase 2's Task 18 had to unpick twice.
  const ledger = page.getByRole('region', { name: /^faturação$/i })
  const payment = ledger.getByRole('region', { name: /registar pagamento/i })
  const adHocCharge = ledger.getByRole('form', { name: /nova cobrança avulsa/i })

  // Create the retainer plan. The section's own "Editar" button toggles the
  // create/renew form; the client page has other "Editar" buttons
  // (ObligationsSection's own adjust toggle), hence the scoping.
  await ledger.getByRole('button', { name: /^editar$/i }).click()
  await ledger.getByLabel(/valor mensal/i).fill('9000')
  await ledger.getByLabel(/dia de vencimento/i).fill('8')
  await ledger.getByLabel(/em vigor desde/i).fill('2026-01-01')
  await ledger.getByRole('button', { name: /^guardar$/i }).click()

  // Reopening the form now offers the renew variant, not the create one —
  // which is what proves the plan actually persisted server-side rather
  // than the form merely having closed.
  await ledger.getByRole('button', { name: /^editar$/i }).click()
  await expect(ledger.getByText(/atualizar valor/i)).toBeVisible()
  await expect(ledger.getByText(/criar plano de retainer/i)).toHaveCount(0)
  await ledger.getByRole('button', { name: /^editar$/i }).click() // close it again

  // The plan itself only produces charges when the daily generation runs
  // (BillingCron, 3AM) — there is no per-client "generate now" control in
  // the UI, so this spec raises the charge it then pays through the ad-hoc
  // route, which lands the same Charge row the generator would and drives
  // the identical propose/confirm allocation path.
  await adHocCharge.getByLabel(/descrição/i).fill('Consultoria extra')
  await adHocCharge.getByLabel(/valor \(cêntimos\)/i).fill('15000')
  await adHocCharge.getByLabel(/data de vencimento/i).fill('2026-10-01')
  await adHocCharge.getByRole('button', { name: /^criar$/i }).click()
  await expect(ledger.getByText(/consultoria extra/i)).toBeVisible()

  // Unpaid, the client is on the home page's receivables list.
  const receivables = page.locator('section').filter({ has: page.getByRole('heading', { name: /recebíveis/i }) })
  await page.goto('/')
  await expect(receivables.getByText(/padaria central faturação/i)).toBeVisible()

  // Record a payment covering the charge in full.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: 'Padaria Central Faturação, Lda.' }).click()
  await payment.getByLabel(/valor \(cêntimos\)/i).fill('15000')
  await payment.getByLabel(/data de receção/i).fill('2026-10-05')
  await payment.getByRole('button', { name: /propor alocação/i }).click()

  // The proposal is one row — the single open charge — for the full amount.
  await expect(payment.getByRole('listitem')).toHaveCount(1)
  await expect(payment.getByRole('listitem').first()).toContainText('150,00')
  await payment.getByRole('button', { name: /^confirmar$/i }).click()

  // The ledger now carries both sides of the movement.
  await expect(ledger.getByText(/pagamento — transfer/i)).toBeVisible()
  await expect(ledger.getByText(/consultoria extra/i)).toBeVisible()

  // And the charge being fully allocated clears the client from receivables.
  await page.goto('/')
  await expect(receivables.getByText(/padaria central faturação/i)).toHaveCount(0)
})
