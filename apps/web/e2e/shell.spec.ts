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

  // Spec §7.1 asks for a fixed sidebar with the account button pinned to its
  // bottom. On a practice's real Overview — dozens of obligations plus the
  // receivables list — a sidebar that scrolls with the page takes every
  // destination and the sign-out control off screen.
  test('keeps the sidebar and the account button in view when the page scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 })
    await signIn(page)
    await expect(page.getByRole('link', { name: /clientes/i })).toBeVisible()
    // Wait for the page's own content: scrolling before the queries settle
    // scrolls a page that is still one screenful tall.
    await expect(page.getByRole('heading', { level: 2, name: /recebíveis/i })).toBeVisible()

    const scrolled = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight)
      return window.scrollY
    })
    expect(scrolled).toBeGreaterThan(0)

    await expect(page.getByRole('link', { name: /clientes/i })).toBeInViewport()
    await expect(page.getByRole('button', { name: /paulo@example\.com/i })).toBeInViewport()
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
