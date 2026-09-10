import { execSync } from 'node:child_process'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

let container: StartedPostgreSqlContainer

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:18.6-alpine').start()

  process.env.DATABASE_URL = container.getConnectionUri()
  // ConfigModule.forRoot's `validate` runs the instant app.module.ts is
  // imported — before any test file's own setup code gets a chance to run —
  // so this has to be set here, not in test/app.ts.
  process.env.AUTH_SALT_SECRET ??= 'test-secret'
  execSync('pnpm exec prisma migrate deploy', {
    cwd: new URL('..', import.meta.url).pathname,
    env: process.env,
    stdio: 'inherit',
  })
}

export async function teardown(): Promise<void> {
  await container?.stop()
}
