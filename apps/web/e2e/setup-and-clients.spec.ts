import { expect, test } from '@playwright/test'

const MASTER_PASSWORD = 'a sufficiently long master password'

test('sets up the account, registers a company and a person, and links them', async ({ page }) => {
  await page.goto('/')

  // First run: the setup form appears instead of login. Bootstrap only ever
  // succeeds once per install (single-account app) — with `workers: 1` the
  // whole e2e suite shares one backend, and whichever spec file's worker
  // reaches this page first performs the real bootstrap; every other spec
  // sees the login page instead. Alphabetical file order decides that
  // winner, and it has already changed once (obligations.spec.ts now sorts
  // before this file), so this can't rely on always winning — fall back to
  // sign-in when the confirm field never appears, same idiom as
  // vault-offline.spec.ts and obligations.spec.ts.
  await page.getByLabel(/email/i).fill('paulo@example.com')
  await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
  // The brief's guess was `/confirmar/i`, but the real label is "Confirma a
  // palavra-passe mestra" (SetupPage.tsx, auth.confirmPasswordLabel in
  // common.json) — "Confirma", not "Confirmar" — so that regex never
  // matched. Narrowed to the substring that is actually present.
  const confirmPasswordField = page.getByLabel(/confirma/i)
  if (await confirmPasswordField.isVisible().catch(() => false)) {
    await confirmPasswordField.fill(MASTER_PASSWORD)
  }
  await page.getByRole('button', { name: /criar|entrar/i }).click()

  await expect(page.getByRole('navigation').getByRole('link', { name: /clientes/i })).toBeVisible()

  // A company.
  await page.getByRole('navigation').getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /^criar$/i }).first().click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Padaria Central, Lda.')
  await page.getByLabel(/^nif$/i).fill('501442600')
  await page.getByRole('button', { name: /^criar$/i }).click()

  await expect(page.getByText('Padaria Central, Lda.')).toBeVisible()

  // A person.
  await page.getByRole('navigation').getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /^criar$/i }).first().click()
  await page.getByLabel(/tipo/i).selectOption('INDIVIDUAL')
  await page.getByLabel(/^nome$/i).fill('Maria Santos')
  await page.getByLabel(/^nif$/i).fill('123456789')
  await page.getByRole('button', { name: /^criar$/i }).click()
  await expect(page.getByRole('heading', { name: 'Maria Santos' })).toBeVisible()

  // Link them from the company page's People tab, through its dialog.
  await page.getByRole('navigation').getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: 'Padaria Central, Lda.' }).click()
  await page.getByRole('tab', { name: /empregados/i }).click()
  await page.getByRole('button', { name: /adicionar vínculo/i }).click()
  const employment = page.getByRole('dialog', { name: /adicionar vínculo/i })
  await employment.getByLabel(/pessoa/i).selectOption({ label: 'Maria Santos' })
  await employment.getByLabel(/data de admissão/i).fill('2024-01-15')
  await employment.getByRole('button', { name: /adicionar vínculo/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The employment row renders the counterparty's name as a link
  // (EmploymentSection.tsx), which is what proves the row appeared.
  await expect(page.getByRole('link', { name: 'Maria Santos' })).toBeVisible()
  await expect(page.getByText(/em vigor/i)).toBeVisible()

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

  // At phone width the client page keeps one row of tabs that scrolls
  // sideways rather than wrapping, and the header's actions move into a menu.
  await nameLink.click()
  const tabStrip = page.getByRole('tablist')
  await expect(tabStrip).toBeVisible()
  expect(await tabStrip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  await page.getByRole('button', { name: /ações do cliente/i }).click()
  await expect(page.getByRole('menuitem', { name: /^editar$/i })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /^arquivar$/i })).toBeVisible()
})

test('switches language without losing the page', async ({ page }) => {
  await page.goto('/')

  // The language control lives in the account menu now. Signed out — which is
  // where this test starts — the menu holds only the language items and is
  // named for them.
  await page.getByRole('button', { name: /idioma|language/i }).click()
  await page.getByRole('menuitemradio', { name: 'English' }).click()

  await expect(page.getByRole('link', { name: 'Clients' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB')
})
