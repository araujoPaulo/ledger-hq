import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client.js'

let client: PrismaClient | undefined

export function getTestPrisma(): PrismaClient {
  client ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
  })
  return client
}

/** Order matters: children before parents. */
export async function resetDatabase(): Promise<void> {
  const prisma = getTestPrisma()

  await prisma.systemHealth.deleteMany()
  await prisma.credentialVersion.deleteMany()
  await prisma.credential.deleteMany()
  await prisma.platform.deleteMany()
  await prisma.employment.deleteMany()
  await prisma.fiscalProfile.deleteMany()
  await prisma.auditEvent.deleteMany()
  await prisma.client.deleteMany()
  await prisma.session.deleteMany()
  await prisma.user.deleteMany()
}
