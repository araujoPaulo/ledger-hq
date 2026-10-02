import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // setup-and-clients.spec.ts and vault-offline.spec.ts both perform this
  // single-user app's one-time account bootstrap; at Playwright's default
  // parallelism the two specs' files run concurrently and race that
  // bootstrap, intermittently failing whichever one loses. Serializing the
  // suite makes this reliable in CI and locally without every future
  // invocation needing to remember `--workers=1`.
  workers: 1,
  use: { baseURL: 'http://localhost:4173', locale: 'pt-PT' },
  webServer: [
    {
      command: 'pnpm --filter @ledger-hq/api start',
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // The API refuses to boot without this (env-validation.ts). Without
      // it here, every spec in the suite fails on a dead web server, not
      // on anything they actually assert.
      env: { ATTACHMENTS_DIR: join(tmpdir(), 'ledger-hq-e2e-attachments') },
    },
    {
      command: 'pnpm --filter @ledger-hq/web preview --port 4173',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
