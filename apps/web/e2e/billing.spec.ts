import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'

const MASTER_PASSWORD = 'a sufficiently long master password'

/** Parses a `Money` component's rendered pt-PT currency text back into cents. */
async function readMoneyCents(locator: Locator): Promise<number> {
  await expect(locator).toBeVisible()
  const text = await locator.innerText()
  const normalized = text.replace(/[^\d,]/g, '').replace(',', '.')
  return Math.round(Number.parseFloat(normalized) * 100)
}

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
  await expect(page.getByRole('navigation').getByRole('link', { name: /clientes/i })).toBeVisible()

  // A distinct name and NIF from every other spec's own client, to avoid a
  // 409 on `clients.tax_id_taken` when the full suite runs together against
  // the one shared backend.
  await page.getByRole('navigation').getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /^criar$/i }).first().click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Padaria Central Faturação, Lda.')
  await page.getByLabel(/^nif$/i).fill('501442634')
  await page.getByRole('button', { name: /^criar$/i }).click()
  await expect(page.getByText('Padaria Central Faturação, Lda.')).toBeVisible()
  // The fiscal profile is a card on the Overview tab; "Preencher" opens it
  // with the kind's defaults, which already imply COMPANY/MONTHLY.
  await page.getByRole('button', { name: /^preencher$/i }).click()
  await page.getByRole('dialog', { name: /perfil fiscal/i }).getByRole('button', { name: /^guardar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // Billing is its own tab, and every form on it opens in a dialog, so each
  // locator below is scoped to the dialog it belongs to — the ambiguity
  // Phase 2 had to unpick twice (two open forms both labelled "Valor") cannot
  // arise any more.
  await page.getByRole('tab', { name: /faturação/i }).click()
  const ledger = page.getByRole('region', { name: /^faturação$/i })

  // Create the retainer plan from its card. Amounts are typed in euros.
  // Back-dated to the first of last month, due on day 1: creating the plan
  // generates its charges at once (master spec §8.1), and both of them —
  // last month's and this month's — have already fallen due, whatever day
  // of the month this runs on.
  const now = new Date()
  const monthLabel = (offset: number) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
    return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`
  }
  const previousMonth = monthLabel(-1)
  const currentMonth = monthLabel(0)
  const today = now.toISOString().slice(0, 10)

  await ledger.getByRole('button', { name: /criar plano de retainer/i }).click()
  const planDialog = page.getByRole('dialog', { name: /criar plano de retainer/i })
  await planDialog.getByLabel(/valor mensal/i).fill('90,00')
  await planDialog.getByLabel(/dia de vencimento/i).fill('1')
  // Pre-filled with today; replaced with the back-dated start.
  await expect(planDialog.getByLabel(/em vigor desde/i)).toHaveValue(today)
  await planDialog.getByLabel(/em vigor desde/i).fill(`${previousMonth}-01`)
  await planDialog.getByRole('button', { name: /^guardar$/i }).click()

  // The card now offers to update the fee instead of creating a plan —
  // which proves the plan persisted server-side, not merely that the dialog
  // closed.
  await expect(ledger.getByRole('button', { name: /atualizar valor/i })).toBeVisible()
  await expect(ledger.getByRole('button', { name: /criar plano de retainer/i })).toHaveCount(0)

  // Both periods since the plan's start are already on the ledger — no
  // waiting for the nightly generation run.
  await expect(ledger.getByText(`Retainer — ${previousMonth}`)).toBeVisible()
  await expect(ledger.getByText(`Retainer — ${currentMonth}`)).toBeVisible()

  // Unpaid, the client is on the home page's receivables list.
  const receivables = page.locator('section').filter({ has: page.getByRole('heading', { name: /recebíveis/i }) })
  await page.goto('/')
  await expect(receivables.getByText(/padaria central faturação/i)).toBeVisible()

  // A receivable links straight to its client's Billing tab.
  await receivables.getByRole('link', { name: /padaria central faturação/i }).click()
  await expect(page).toHaveURL(/\?tab=billing/)

  // Record a payment covering both charges in full.
  await ledger.getByRole('button', { name: /registar pagamento/i }).click()
  const payment = page.getByRole('dialog', { name: /registar pagamento/i })
  await payment.getByLabel(/^valor$/i).fill('180,00')
  await payment.getByLabel(/data de receção/i).fill(today)
  await payment.getByRole('button', { name: /propor alocação/i }).click()

  // The proposal is both open charges, oldest first.
  await expect(payment.getByText(`Retainer — ${previousMonth}`)).toBeVisible()
  await expect(payment.getByText(`Retainer — ${currentMonth}`)).toBeVisible()
  await payment.getByRole('button', { name: /^confirmar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The ledger now carries both sides of the movement.
  await expect(ledger.getByText(/pagamento — transfer/i)).toBeVisible()

  // And both charges being fully allocated clears the client from receivables.
  await page.goto('/')
  await expect(receivables.getByText(/padaria central faturação/i)).toHaveCount(0)
})

test('records an advance payment, sees it as credit, and spends it on a later charge', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel(/email/i).fill('paulo@example.com')
  await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
  const confirmPasswordField = page.getByLabel(/confirma/i)
  if (await confirmPasswordField.isVisible().catch(() => false)) {
    await confirmPasswordField.fill(MASTER_PASSWORD)
  }
  await page.getByRole('button', { name: /criar|entrar/i }).click()
  await expect(page.getByRole('navigation').getByRole('link', { name: /clientes/i })).toBeVisible()

  await page.getByRole('navigation').getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /^criar$/i }).first().click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Talho do Bairro Crédito, Lda.')
  // Checksum-valid and unused by any other spec in apps/web/e2e (the others
  // take 123456789 and 5014426xx).
  await page.getByLabel(/^nif$/i).fill('507555554')
  await page.getByRole('button', { name: /^criar$/i }).click()
  // The fiscal profile is a card on the Overview tab; "Preencher" opens it
  // with the kind's defaults, which already imply COMPANY/MONTHLY.
  await page.getByRole('button', { name: /^preencher$/i }).click()
  await page.getByRole('dialog', { name: /perfil fiscal/i }).getByRole('button', { name: /^guardar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('tab', { name: /faturação/i }).click()
  const ledger = page.getByRole('region', { name: /^faturação$/i })
  const credit = ledger.getByRole('region', { name: /crédito disponível/i })

  // A payment with nothing to settle: every cent becomes credit.
  await ledger.getByRole('button', { name: /registar pagamento/i }).click()
  const payment = page.getByRole('dialog', { name: /registar pagamento/i })
  await payment.getByLabel(/^valor$/i).fill('270,00')
  await payment.getByLabel(/data de receção/i).fill('2026-01-05')
  await payment.getByRole('button', { name: /propor alocação/i }).click()
  await payment.getByRole('button', { name: /^confirmar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await expect(credit.getByText(/crédito disponível/i)).toBeVisible()

  // Now give it something to settle, due in the past so it has fallen due.
  await ledger.getByRole('button', { name: /nova cobrança avulsa/i }).click()
  const chargeDialog = page.getByRole('dialog', { name: /nova cobrança avulsa/i })
  await chargeDialog.getByLabel(/descrição/i).fill('Trabalho extra')
  await chargeDialog.getByLabel(/^valor$/i).fill('90,00')
  await chargeDialog.getByLabel(/data de vencimento/i).fill('2026-02-28')
  await chargeDialog.getByRole('button', { name: /^criar$/i }).click()
  await expect(ledger.getByText(/trabalho extra/i)).toBeVisible()

  // `getReceivables` nets credit against debt notionally (design §4.4) the
  // moment a due charge exists, regardless of whether that credit has ever
  // actually been spent: `outstandingCents = max(gross - credit, 0)`, and
  // spending credit lowers `gross` and `credit` by the same amount, so that
  // net figure — and the home page's "Em dívida" tile, which sums it — is
  // mathematically unchanged by this confirm. It was already 0,00 EUR for
  // this client before the confirm below (270,00 EUR of credit already
  // covers the 90,00 EUR charge on paper) and stays 0,00 EUR after, so
  // asserting a fall there would either be vacuously true or, worse, false.
  // What the confirm actually writes is real `PaymentAllocation` rows that
  // convert notional credit into spent credit, which is only visible in
  // `payment_credits.creditCents` — the figure this form itself shows. That
  // is what is captured before and after here, so the assertion fails if
  // the confirm were ever a no-op rather than passing for the wrong reason.
  const availableCredit = credit.locator('.tabular-nums').first()
  const creditBeforeCents = await readMoneyCents(availableCredit)
  expect(creditBeforeCents).toBe(27000)

  // "Aplicar crédito" proposes first, in a dialog; nothing is written until Confirm.
  await credit.getByRole('button', { name: /aplicar crédito/i }).click()
  const creditDialog = page.getByRole('dialog', { name: /crédito disponível/i })
  await expect(creditDialog.getByText(/trabalho extra/i)).toBeVisible()
  await creditDialog.getByRole('button', { name: /^confirmar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)


  // The confirm mutation's own success handler re-fetches the ledger
  // asynchronously, so reading `availableCredit` right away would race it —
  // wait for the figure itself to settle on its new value first.
  await expect(availableCredit).toHaveText('180,00 €')

  // The 90,00 EUR charge was settled out of the 270,00 EUR credit, leaving
  // exactly 180,00 EUR — not just "less than before", but the precise
  // amount the charge was worth.
  const creditAfterCents = await readMoneyCents(availableCredit)
  expect(creditBeforeCents - creditAfterCents).toBe(9000)
  expect(creditAfterCents).toBe(18000)

  // The debt is settled from credit alone, so the client never appears in
  // receivables. There is no "início"/"home" nav link (the sidebar's home
  // destination is labelled "Resumo"), so returning to the home page
  // reuses this file's own idiom above.
  await page.goto('/')
  await expect(page.getByText('Talho do Bairro Crédito, Lda.')).toHaveCount(0)
})
