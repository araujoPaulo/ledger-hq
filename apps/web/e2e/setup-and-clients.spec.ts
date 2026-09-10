import { expect, test } from '@playwright/test'

const MASTER_PASSWORD = 'a sufficiently long master password'

test('sets up the account, registers a company and a person, and links them', async ({ page }) => {
  await page.goto('/')

  // First run: the setup form appears instead of login.
  await page.getByLabel(/email/i).fill('paulo@example.com')
  await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
  // The brief's guess was `/confirmar/i`, but the real label is "Confirma a
  // palavra-passe mestra" (SetupPage.tsx, auth.confirmPasswordLabel in
  // common.json) — "Confirma", not "Confirmar" — so that regex never
  // matched. Narrowed to the substring that is actually present.
  await page.getByLabel(/confirma/i).fill(MASTER_PASSWORD)
  await page.getByRole('button', { name: /criar|entrar/i }).click()

  await expect(page.getByRole('link', { name: /clientes/i })).toBeVisible()

  // A company.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Padaria Central, Lda.')
  await page.getByLabel(/^nif$/i).fill('501442600')
  await page.getByRole('button', { name: /guardar/i }).click()

  await expect(page.getByText('Padaria Central, Lda.')).toBeVisible()

  // A person.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('INDIVIDUAL')
  await page.getByLabel(/^nome$/i).fill('Maria Santos')
  await page.getByLabel(/^nif$/i).fill('123456789')
  await page.getByRole('button', { name: /guardar/i }).click()

  // Link them from the company page.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: 'Padaria Central, Lda.' }).click()
  await page.getByLabel(/pessoa/i).selectOption({ label: 'Maria Santos' })
  await page.getByLabel(/data de admissão/i).fill('2024-01-15')
  await page.getByRole('button', { name: /adicionar vínculo/i }).click()

  // `getByText('Maria Santos')` is ambiguous here: the just-submitted
  // counterparty <select> still has an (invisible, collapsed) `<option>`
  // with that same text, and Playwright's strict mode rejects the match.
  // The employment row renders the counterparty's name as a link
  // (EmploymentSection.tsx), which is what actually proves the row appeared.
  await expect(page.getByRole('link', { name: 'Maria Santos' })).toBeVisible()
  await expect(page.getByText(/em vigor/i)).toBeVisible()
})

test('switches language without losing the page', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('combobox', { name: /idioma|language/i }).selectOption('en-GB')

  await expect(page.getByRole('link', { name: 'Clients' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB')
})
