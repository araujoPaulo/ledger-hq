import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const MASTER_PASSWORD = 'a sufficiently long master password'

// The same bootstrap-or-sign-in block every other spec in this directory
// inlines: bootstrap succeeds only once per install, so the confirm field is
// present on a fresh database and absent on a reused one.
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

// The sidebar/tab-bar switch is a media query, which jsdom does not evaluate.
// This is the only place it can be asserted.
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

    // The sidebar is display:none here, so this resolves to the tab bar's icon
    // link, which carries the same label the desktop item shows as text.
    const vaultTab = page.getByRole('link', { name: /cofre/i })
    await expect(vaultTab).toBeVisible()
    await vaultTab.click()
    await expect(page).toHaveURL(/\/vault\/platforms$/)
  })
})
