import { execSync } from 'node:child_process'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

let container: StartedPostgreSqlContainer

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:18.6-alpine').start()

  process.env.DATABASE_URL = container.getConnectionUri()
  execSync('pnpm exec prisma migrate deploy', {
    cwd: new URL('..', import.meta.url).pathname,
    env: process.env,
    stdio: 'inherit',
  })
}

export async function teardown(): Promise<void> {
  await container?.stop()
}
