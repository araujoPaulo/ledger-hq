import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteOutboxEvent,
  getVaultMeta,
  listCachedCredentials,
  listCachedPlatforms,
  listOutboxEvents,
  putCachedCredentials,
  putCachedPlatforms,
  putVaultMeta,
  queueOutboxEvent,
} from './vault-db'
import type { CachedCredential } from './vault-db'

const credential: CachedCredential = {
  id: 'c1',
  clientId: 'client1',
  platformId: 'p1',
  label: 'Acesso principal',
  updatedAt: '2026-09-10T00:00:00.000Z',
  ciphertext: 'AAAA',
  iv: 'BBBB',
}

beforeEach(async () => {
  indexedDB.deleteDatabase('ledger-hq-vault')
})

describe('vault-db', () => {
  it('round-trips vault metadata', async () => {
    await putVaultMeta({ id: 'singleton', kdfSalt: 'AAAA', protectedVaultKey: 'BBBB', lastSyncedAt: null })
    await expect(getVaultMeta()).resolves.toEqual({
      id: 'singleton',
      kdfSalt: 'AAAA',
      protectedVaultKey: 'BBBB',
      lastSyncedAt: null,
    })
  })

  it('round-trips cached credentials, listed by client', async () => {
    await putCachedCredentials([credential])
    await expect(listCachedCredentials('client1')).resolves.toEqual([credential])
    await expect(listCachedCredentials('someone-else')).resolves.toEqual([])
  })

  it('round-trips cached platforms', async () => {
    await putCachedPlatforms([{ id: 'p1', name: 'Portal das Finanças', url: null, authKind: 'PASSWORD' }])
    await expect(listCachedPlatforms()).resolves.toEqual([
      { id: 'p1', name: 'Portal das Finanças', url: null, authKind: 'PASSWORD' },
    ])
  })

  it('refuses to cache a credential carrying an extra field', async () => {
    const contaminated = { ...credential, password: 'hunter2' } as unknown as CachedCredential
    await expect(putCachedCredentials([contaminated])).rejects.toThrow(/unexpected fields/)
  })

  it('refuses to cache a credential missing a required field', async () => {
    const { iv: _iv, ...incomplete } = credential
    await expect(putCachedCredentials([incomplete as CachedCredential])).rejects.toThrow(/unexpected fields/)
  })

  it('queues, lists and deletes outbox events', async () => {
    const event = { id: 'e1', entityType: 'credential', entityId: 'c1', action: 'credential.revealed', metadata: {}, occurredAt: '2026-09-10T00:00:00.000Z' }
    await queueOutboxEvent(event)
    await expect(listOutboxEvents()).resolves.toEqual([event])

    await deleteOutboxEvent('e1')
    await expect(listOutboxEvents()).resolves.toEqual([])
  })
})
