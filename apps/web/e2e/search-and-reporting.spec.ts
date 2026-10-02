import { expect, test } from '@playwright/test'

const MASTER_PASSWORD = 'a sufficiently long master password'

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByLabel(/email/i).fill('paulo@example.com')
  await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
  const confirmPasswordField = page.getByLabel(/confirma/i)
  if (await confirmPasswordField.isVisible().catch(() => false)) {
    await confirmPasswordField.fill(MASTER_PASSWORD)
  }
  await page.getByRole('button', { name: /criar|entrar/i }).click()
  await expect(page.getByRole('link', { name: /clientes/i })).toBeVisible()
}

test('finds a client by a three-letter prefix and opens it', async ({ page }) => {
  await signIn(page)

  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Mercearia Pesquisável, Lda.')
  await page.getByLabel(/^nif$/i).fill('507666666')
  await page.getByRole('button', { name: /guardar/i }).click()
  await expect(page.getByText('Mercearia Pesquisável, Lda.')).toBeVisible()

  // The shell's box, not the clients page's own filter.
  await page.getByRole('searchbox', { name: /pesquisar/i }).fill('merc')

  await expect(page).toHaveURL(/\/search\?q=merc/)
  await page.getByRole('link', { name: /mercearia pesquisável/i }).click()
  await expect(page.getByText('Mercearia Pesquisável, Lda.')).toBeVisible()
})

test('lists a client that is both overdue and in arrears on the reporting page', async ({ page }) => {
  await signIn(page)

  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Talho em Risco, Lda.')
  await page.getByLabel(/^nif$/i).fill('507777778')
  await page.getByRole('button', { name: /guardar/i }).click()
  await page.getByRole('button', { name: /guardar/i }).click() // fiscal profile defaults, which already imply COMPANY/MONTHLY

  // Saving the profile only proposes a regeneration; it does not create
  // obligation instances until applied (obligations.spec.ts's own comment on
  // this same banner). MONTHLY VAT generates one instance per month across
  // the generator's [asOf - 3 months, asOf + 12 months] window, so applying
  // it deterministically leaves this fresh client with a still-PENDING
  // instance whose `dueDate` is already in the past — the overdue side the
  // at-risk report needs. `.first()` disambiguates the dozen or so
  // same-named rows the window produces.
  await expect(page.getByRole('button', { name: /aplicar/i })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /aplicar/i }).click()
  await expect(page.getByText(/declaração periódica de iva/i).first()).toBeVisible()

  // A charge already past its due date puts the client in arrears, the
  // report's other half.
  const ledger = page.getByRole('region', { name: /^faturação$/i })
  const adHocCharge = ledger.getByRole('form', { name: /nova cobrança avulsa/i })
  await adHocCharge.getByLabel(/descrição/i).fill('Trabalho extra')
  await adHocCharge.getByLabel(/valor \(cêntimos\)/i).fill('20000')
  await adHocCharge.getByLabel(/data de vencimento/i).fill('2026-02-28')
  // AddAdHocChargeForm's own submit button reads "Criar" (common:actions.create),
  // not "Guardar" — unlike the retainer-plan and fiscal-profile forms above.
  await adHocCharge.getByRole('button', { name: /^criar$/i }).click()

  await page.getByRole('link', { name: /relatórios/i }).click()
  await expect(page.getByRole('heading', { name: /^em risco$/i })).toBeVisible()
  await expect(page.getByText('Talho em Risco, Lda.')).toBeVisible()
})

test('downloads the period summary report as a CSV with the real figures in it', async ({ page }) => {
  // `downloadCsv` builds the file as an in-page Blob and revokes its object
  // URL the instant `anchor.click()` returns, so there is no reading it back
  // out of the filesystem through a Node API afterwards (and this project's
  // `tsconfig` deliberately gives `apps/web` no Node types to do that with).
  // Hooking `URL.createObjectURL` from the page side, before anything
  // navigates, captures the real text the browser would have saved.
  // A boxed value, not a bare `let`: TypeScript's control-flow narrowing
  // otherwise treats the only assignment reaching `capturedCsv` as the
  // closure below, whose write it cannot order against the poll's reads.
  const csvCapture: { value: string | null } = { value: null }
  await page.exposeFunction('__captureDownloadedCsv', (text: string) => {
    csvCapture.value = text
  })
  await page.addInitScript(() => {
    const browserCreateObjectURL = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (blob: Blob) => {
      void blob.text().then((text) => {
        ;(window as unknown as { __captureDownloadedCsv: (text: string) => void }).__captureDownloadedCsv(text)
      })
      return browserCreateObjectURL(blob)
    }
  })

  await signIn(page)

  await page.getByRole('link', { name: /relatórios/i }).click()
  const periodSummary = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /^resumo do período$/i }) })
  await expect(periodSummary).toBeVisible()

  // Wait for the query to settle before downloading — the button is only
  // rendered once `summary.data` exists, so waiting on a data-dependent
  // label (not the always-present heading) also proves the report actually
  // rendered its figures rather than racing a loading skeleton.
  await expect(periodSummary.getByText(/obrigações com prazo/i)).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await periodSummary.getByRole('button', { name: /descarregar csv/i }).click()
  const download = await downloadPromise

  // Proves a real download fired, not just an in-page Blob.
  expect(download.suggestedFilename()).toMatch(/^period-summary-\d{4}-01-01_\d{4}-12-31\.csv$/)

  await expect.poll(() => csvCapture.value).not.toBeNull()
  const csv: string = csvCapture.value ?? ''

  // The CSV's content is the thing being proven, not just that a file
  // arrived: its header row names the real columns (`;`-delimited — `toCsv`
  // picks the delimiter from the pt-PT locale this suite runs under, since
  // `,` is that locale's own decimal mark), and the one data row has the
  // right shape: two dd/mm/yyyy dates, two plain counts, three pt-PT
  // decimal-comma amounts.
  //
  // Built from its code point, not written as the literal character, same
  // reason `toCsv.ts` gives: the literal is invisible in source.
  const bom = String.fromCharCode(0xfeff)
  const withoutBom = csv.startsWith(bom) ? csv.slice(bom.length) : csv
  const [headerLine, ...dataLines] = withoutBom.trim().split('\r\n')
  expect(headerLine).toBe(
    'De;Até;Obrigações com prazo;Obrigações entregues;Cobranças emitidas;Pagamentos recebidos;Crédito por aplicar no fecho;Em dívida no fecho',
  )
  expect(dataLines).toHaveLength(1)
  expect(dataLines[0]).toMatch(/^\d{2}\/\d{2}\/\d{4};\d{2}\/\d{2}\/\d{4};\d+;\d+;\d+,\d{2};\d+,\d{2};\d+,\d{2};\d+,\d{2}$/)
})
