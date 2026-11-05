import { Buffer } from 'node:buffer'
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
  await expect(page.getByRole('navigation').getByRole('link', { name: /clientes/i })).toBeVisible()

  // Register a company client with an open, monthly-VAT fiscal profile.
  // Distinct name and NIF from `setup-and-clients.spec.ts`'s own company:
  // when the full suite runs all spec files together, both specs' clients
  // live in the same shared backend/DB, and a matching NIF would 409 on
  // `clients.tax_id_taken` (same reasoning `vault-offline.spec.ts` documents
  // for its own client).
  await page.getByRole('navigation').getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /^criar$/i }).first().click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Padaria Central Obrigações, Lda.')
  await page.getByLabel(/^nif$/i).fill('501442626')
  await page.getByRole('button', { name: /^criar$/i }).click()
  await expect(page.getByText('Padaria Central Obrigações, Lda.')).toBeVisible()

  // The fiscal profile is a card on the Overview tab; "Preencher" opens it
  // with the kind's defaults, which already imply COMPANY/MONTHLY.
  await page.getByRole('button', { name: /^preencher$/i }).click()
  await page.getByRole('dialog', { name: /perfil fiscal/i }).getByRole('button', { name: /^guardar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The generator preview lives on the Obligations tab.
  await page.getByRole('tab', { name: /obrigações/i }).click()

  // The regenerate preview banner should appear once the profile exists.
  // MONTHLY VAT generates one instance per month across the generator's
  // calendar-year window (obligations.service.ts's `yearStart`/`yearEnd`),
  // not just one for "today" — a dozen "Declaração periódica de IVA" rows
  // appear at once, so `.first()` disambiguates
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
  await page.getByRole('navigation').getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: 'Padaria Central Obrigações, Lda.' }).click()
  await page.getByRole('tab', { name: /obrigações/i }).click()

  // Scoped to the section, then to the dialog Edit opens: the adjust form is
  // the only thing on screen once it is open.
  const obligations = page.getByRole('region', { name: /obrigações fiscais/i })
  await obligations.getByRole('button', { name: /^editar$/i }).first().click()
  const adjust = page.getByRole('dialog')
  await adjust.getByLabel(/prazo/i).fill('2026-12-31')
  await adjust.getByRole('button', { name: /^guardar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // The saved row renders the date through `formatDate` (b0f5b17), so the
  // assertion is on the pt-PT rendering, not on the ISO value typed above.
  // The generator's calendar-year window can also produce an obligation that
  // naturally falls due on that day, so the row is told apart by the
  // "overridden" marker the adjusted date carries.
  await expect(
    obligations.getByRole('listitem').filter({ hasText: '31/12/2026' }).filter({ hasText: /data alterada manualmente/i }),
  ).toHaveCount(1)
})

test('attaches a receipt to an obligation, downloads it, and keeps it out of the service-worker cache', async ({ page }) => {
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
  await page.getByLabel(/^nome$/i).fill('Padaria Central Anexos, Lda.')
  await page.getByLabel(/^nif$/i).fill('507555570')
  await page.getByRole('button', { name: /^criar$/i }).click()
  // The fiscal profile is a card on the Overview tab; "Preencher" opens it
  // with the kind's defaults, which already imply COMPANY/MONTHLY.
  await page.getByRole('button', { name: /^preencher$/i }).click()
  await page.getByRole('dialog', { name: /perfil fiscal/i }).getByRole('button', { name: /^guardar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('tab', { name: /obrigações/i }).click()
  const obligations = page.getByRole('region', { name: /obrigações fiscais/i })
  await expect(page.getByRole('button', { name: /aplicar/i })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /aplicar/i }).click()
  await expect(obligations.getByText(/declaração periódica de iva/i).first()).toBeVisible()

  await obligations.getByRole('button', { name: /^comprovativos$/i }).first().click()
  const panel = page.getByRole('dialog', { name: /comprovativos/i })

  // A real, minimal PDF: the API sniffs the leading bytes and rejects
  // anything whose contents disagree with its declared type.
  await panel.getByLabel(/anexar ficheiro/i).setInputFiles({
    name: 'Declaração periódica.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'),
  })

  const link = panel.getByRole('link', { name: /transferir declaração periódica\.pdf/i })
  await expect(link).toBeVisible({ timeout: 15_000 })

  // It survives a reload, which is what proves it reached the server rather
  // than only the component's state.
  await page.reload()
  await obligations.getByRole('button', { name: /^comprovativos$/i }).first().click()
  await expect(panel.getByRole('link', { name: /transferir declaração periódica\.pdf/i })).toBeVisible()

  const href = await panel.getByRole('link', { name: /transferir/i }).first().getAttribute('href')
  const downloaded = await page.request.get(href!)
  expect(downloaded.status()).toBe(200)
  expect(downloaded.headers()['content-type']).toContain('application/pdf')
  expect(downloaded.headers()['content-disposition']).toContain(`filename*=UTF-8''Declara%C3%A7%C3%A3o`)

  // `page.request.get` above is Playwright's APIRequestContext: a separate
  // HTTP client that never touches the page's service worker, so it proves
  // nothing about the NetworkOnly cache rule below. The rule only ever sees
  // a request that the page itself issues — exactly what "open in new tab"
  // or the anchor's own click does — so proving the rule still exists means
  // driving the same download through `page.evaluate`'s `fetch`, which the
  // controlling service worker's fetch handler actually intercepts.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 })
  const swFetchOk = await page.evaluate(async (url) => {
    const response = await fetch(url)
    return response.ok
  }, href!)
  expect(swFetchOk).toBe(true)

  // The receipt must not be sitting in the PWA read cache in plaintext.
  const cachedUrls = await page.evaluate(async () => {
    const names = await caches.keys()
    const urls: string[] = []
    for (const name of names) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) urls.push(request.url)
    }
    return urls
  })
  expect(cachedUrls.filter((url) => /\/attachments\/[^/]+$/.test(url))).toEqual([])
})
