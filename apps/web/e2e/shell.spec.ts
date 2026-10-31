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

  test('opens the new platform dialog on a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)

    await page.getByRole('link', { name: /cofre/i }).click()
    await page.getByRole('button', { name: /nova plataforma/i }).click()
    await expect(page.getByRole('dialog', { name: /nova plataforma/i })).toBeVisible()
  })

  // Signed out there is no shell: the sidebar and the tab bar are both
  // absent, not merely hidden. The unit tests prove the gate; this proves it
  // in the built app at both viewports, and that the URL survives sign-in.
  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'phone', width: 390, height: 844 },
  ]) {
    test(`shows only the auth card when signed out, then the shell on the same URL (${viewport.name})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/clients')

      // Sign-in, or account setup on a fresh install — see signIn() above.
      await expect(page.getByRole('heading', { level: 1, name: /^entrar$|configura a tua conta/i })).toBeVisible()
      await expect(page.getByRole('navigation')).toHaveCount(0)
      await expect(page.getByRole('searchbox')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /idioma/i })).toBeVisible()

      await page.getByLabel(/email/i).fill('paulo@example.com')
      await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
      const confirmPasswordField = page.getByLabel(/confirma/i)
      if (await confirmPasswordField.isVisible().catch(() => false)) {
        await confirmPasswordField.fill(MASTER_PASSWORD)
      }
      await page.getByRole('button', { name: /^criar$|^entrar$/i }).click()

      // The shell appears around the route the URL already named.
      await expect(page).toHaveURL(/\/clients$/)
      await expect(page.getByRole('heading', { level: 1, name: /clientes/i })).toBeVisible()
      // Both navs are in the DOM; the media query shows exactly one — the
      // sidebar on desktop, the tab bar on a phone. `.first()` alone would be
      // the sidebar, which is display:none at 390px.
      await expect(page.getByRole('navigation').filter({ visible: true })).toHaveCount(1)
    })
  }
})
