import { expect, test } from '@playwright/test'

const MASTER_PASSWORD = 'a sufficiently long master password'

test('sets up the vault, adds a credential, and reads it back with the network disabled', async ({ page, context }) => {
  await page.goto('/')

  // First run: bootstrap the account. Bootstrap only ever succeeds once per
  // install (single-account app), and `setup-and-clients.spec.ts` bootstraps
  // this exact same account. When the full e2e suite runs all spec files
  // together (Step 4 below), whichever file's worker gets there first wins
  // SetupPage's "confirm password" field; the other sees plain LoginPage
  // instead (no confirm field) and must sign in rather than create — this is
  // deterministic by file-discovery order, not just worker-race flakiness,
  // so it reproduces even with `--workers=1`. Same credentials either way,
  // so falling back to sign-in when the confirm field never appears keeps
  // this spec correct standing alone AND alongside the others.
  await page.getByLabel(/email/i).fill('paulo@example.com')
  await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
  const confirmPasswordField = page.getByLabel(/confirma/i)
  if (await confirmPasswordField.isVisible().catch(() => false)) {
    await confirmPasswordField.fill(MASTER_PASSWORD)
  }
  await page.getByRole('button', { name: /criar|entrar/i }).click()
  await expect(page.getByRole('link', { name: /clientes/i })).toBeVisible()

  // Register a client to attach a credential to.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  // Distinct name and NIF from `setup-and-clients.spec.ts`'s own company:
  // when the full suite runs all spec files together (Step 4), both specs'
  // clients live in the same shared backend/DB. A matching NIF would 409 on
  // `clients.tax_id_taken`, and a matching name would make
  // `getByRole('link', { name: ... })` below ambiguous (two clients, same
  // accessible name) under Playwright's strict mode.
  await page.getByLabel(/^nome$/i).fill('Padaria Central Vault, Lda.')
  await page.getByLabel(/^nif$/i).fill('501442618')
  await page.getByRole('button', { name: /guardar/i }).click()
  await expect(page.getByText('Padaria Central Vault, Lda.')).toBeVisible()

  // Set up the vault (re-enters the master password by design — see Task 12).
  // `ClientFormPage` already navigated us to this client's detail page after
  // "Guardar", and its Credentials section (VaultUnlockGate) offers a link
  // into vault setup from right here. The brief's original `page.goto('/vault/setup')`
  // is a full browser navigation — it would tear down the in-memory JS module
  // state (vault-session.ts's singleton) that `unlockVault()` sets a few lines
  // below, silently re-locking the vault before the credential step and
  // contradicting this very comment. Reaching the route via the app's own
  // `<Link>` instead is a client-side route change, so that state survives.
  await page.getByRole('link', { name: /configurar agora/i }).click()
  await page.getByLabel(/confirma a tua palavra-passe/i).fill(MASTER_PASSWORD)
  await page.getByRole('button', { name: /continuar/i }).click()
  await expect(page.getByText(/-.*-.*-.*-.*-/)).toBeVisible() // the recovery code, dash-grouped
  await page.getByLabel(/anotei o código/i).check()
  await page.getByRole('button', { name: /continuar/i }).click()

  // Add a platform. Reached via the persistent nav link, not `page.goto`, for
  // the same in-memory-state reason as above. The platform catalog is seeded
  // with "Portal das Finanças" by the vault migration (a permanent fixture,
  // not test leftover — see `20260911083418_vault/migration.sql`), so this
  // create attempt 409s on the name and the list keeps showing the one
  // already there; the credential step below still exercises a real,
  // attached platform either way.
  await page.getByRole('link', { name: /plataformas/i }).click()
  await page.getByLabel(/^nome$/i).fill('Portal das Finanças')
  await page.getByRole('button', { name: /criar/i }).click()
  await expect(page.getByText('Portal das Finanças')).toBeVisible()

  // Add a credential on the client's page. The vault is already unlocked
  // from the setup flow above, in the same browser session.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: 'Padaria Central Vault, Lda.' }).click()
  await page.getByLabel(/designação/i).fill('Acesso principal')
  await page.getByLabel(/utilizador/i).fill('509123456')
  await page.getByLabel(/^palavra-passe$/i).fill('correct horse battery staple')
  await page.getByRole('button', { name: /criar/i }).click()
  // `getByText(/portal das finanças/i)` alone is ambiguous here: the
  // AddCredentialForm's platform <select> still has a matching (collapsed)
  // <option> with that same text, and Playwright's strict mode rejects the
  // match — same class of ambiguity `setup-and-clients.spec.ts` already
  // documents for "Maria Santos". The credential row renders "<platform> —
  // <label>", which is what actually proves the row appeared.
  await expect(page.getByText(/portal das finanças — acesso principal/i)).toBeVisible()

  // Let the service worker precache the shell before going offline.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 })

  // Reload: this clears every in-memory JS singleton, including the
  // unlocked vault key — the only thing that survives is what was written
  // to IndexedDB and the Cache Storage precache. Then disable the network
  // entirely before unlocking again.
  await context.setOffline(true)
  await page.reload()

  await expect(page.getByRole('status')).toContainText(/sem ligação ao servidor/i)
  await page.getByLabel(/palavra-passe mestra/i).fill(MASTER_PASSWORD)
  await page.getByRole('button', { name: /desbloquear/i }).click()

  await page.getByRole('button', { name: /^ver$/i }).click()
  await expect(page.getByText('509123456')).toBeVisible()

  await context.setOffline(false)
})
