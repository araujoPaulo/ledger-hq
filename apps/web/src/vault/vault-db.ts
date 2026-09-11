import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'

interface VaultSchema extends DBSchema {
  vaultMeta: { key: string; value: VaultMetaRecord }
  credentials: { key: string; value: CachedCredential; indexes: { byClient: string } }
  platforms: { key: string; value: CachedPlatform }
  outbox: { key: string; value: OutboxEvent }
}

export type VaultMetaRecord = {
  id: 'singleton'
  kdfSalt: string
  protectedVaultKey: string
  lastSyncedAt: string | null
}

export type CachedCredential = {
  id: string
  clientId: string
  platformId: string
  label: string
  updatedAt: string
  ciphertext: string
  iv: string
}

export type CachedPlatform = { id: string; name: string; url: string | null; authKind: string }

export type OutboxEvent = {
  id: string
  entityType: string
  entityId: string
  action: string
  metadata: Record<string, unknown>
  occurredAt: string
}

const CACHED_CREDENTIAL_KEYS = ['id', 'clientId', 'platformId', 'label', 'updatedAt', 'ciphertext', 'iv']

let dbPromise: Promise<IDBPDatabase<VaultSchema>> | undefined

function getDb(): Promise<IDBPDatabase<VaultSchema>> {
  dbPromise ??= openDB<VaultSchema>('ledger-hq-vault', 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('vaultMeta', { keyPath: 'id' })
        const credentials = db.createObjectStore('credentials', { keyPath: 'id' })
        credentials.createIndex('byClient', 'clientId')
        db.createObjectStore('platforms', { keyPath: 'id' })
      }
      if (oldVersion < 2) {
        db.createObjectStore('outbox', { keyPath: 'id' })
      }
    },
  })
  return dbPromise
}

export async function putVaultMeta(meta: VaultMetaRecord): Promise<void> {
  const db = await getDb()
  await db.put('vaultMeta', meta)
}

export async function getVaultMeta(): Promise<VaultMetaRecord | undefined> {
  const db = await getDb()
  return db.get('vaultMeta', 'singleton')
}

/**
 * The only write path for cached credentials. Every item's shape is checked
 * against the fixed safe field set before it reaches IndexedDB — a runtime
 * guard against a future caller accidentally spreading a decrypted item
 * (username, password, totpSecret, ...) into what must only ever hold
 * ciphertext plus metadata. Stronger than a spy-based test alone, since it
 * also protects production, not just the test suite.
 */
export async function putCachedCredentials(items: CachedCredential[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('credentials', 'readwrite')
  for (const item of items) {
    assertSafeCredentialShape(item)
    await tx.store.put(item)
  }
  await tx.done
}

function assertSafeCredentialShape(item: CachedCredential): void {
  const keys = Object.keys(item).sort()
  const expected = [...CACHED_CREDENTIAL_KEYS].sort()
  const matches = keys.length === expected.length && keys.every((key, index) => key === expected[index])
  if (!matches) throw new Error(`refusing to cache a credential with unexpected fields: ${keys.join(', ')}`)
}

export async function listCachedCredentials(clientId: string): Promise<CachedCredential[]> {
  const db = await getDb()
  return db.getAllFromIndex('credentials', 'byClient', clientId)
}

export async function putCachedPlatforms(items: CachedPlatform[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('platforms', 'readwrite')
  for (const item of items) await tx.store.put(item)
  await tx.done
}

export async function listCachedPlatforms(): Promise<CachedPlatform[]> {
  const db = await getDb()
  return db.getAll('platforms')
}

export async function queueOutboxEvent(event: OutboxEvent): Promise<void> {
  const db = await getDb()
  await db.put('outbox', event)
}

export async function listOutboxEvents(): Promise<OutboxEvent[]> {
  const db = await getDb()
  return db.getAll('outbox')
}

export async function deleteOutboxEvent(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('outbox', id)
}
