import { expect, test } from '@playwright/test'

test('the application shell still renders with the network down', async ({ page, context }) => {
  await page.goto('/')
  // Let the service worker install and precache the shell.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 20_000,
  })

  await context.setOffline(true)
  await page.reload()

  await expect(page.getByText(/ledger hq/i)).toBeVisible()
  await expect(page.getByRole('status')).toContainText(/sem ligação ao servidor/i)

  await context.setOffline(false)
})
