import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ apiFetch: apiFetchMock }))

const queueOutboxEventMock = vi.hoisted(() => vi.fn())
const listOutboxEventsMock = vi.hoisted(() => vi.fn())
const deleteOutboxEventMock = vi.hoisted(() => vi.fn())
vi.mock('./vault-db', () => ({
  queueOutboxEvent: queueOutboxEventMock,
  listOutboxEvents: listOutboxEventsMock,
  deleteOutboxEvent: deleteOutboxEventMock,
}))

const { flushOutbox, recordReveal } = await import('./outbox')

describe('outbox', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    queueOutboxEventMock.mockReset().mockResolvedValue(undefined)
    listOutboxEventsMock.mockReset()
    deleteOutboxEventMock.mockReset().mockResolvedValue(undefined)
  })

  it('recordReveal queues an event and flushes it when online', async () => {
    listOutboxEventsMock.mockResolvedValue([
      { id: 'e1', entityType: 'credential', entityId: 'c1', action: 'credential.revealed', metadata: {}, occurredAt: '2026-09-10T00:00:00.000Z' },
    ])
    apiFetchMock.mockResolvedValue(undefined)

    await recordReveal('c1')

    expect(queueOutboxEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'credential', entityId: 'c1', action: 'credential.revealed' }),
    )
    expect(apiFetchMock).toHaveBeenCalledWith('/vault/audit-events', expect.objectContaining({ method: 'POST' }))
    expect(deleteOutboxEventMock).toHaveBeenCalledWith('e1')
  })

  it('flushOutbox leaves an event queued when the request fails', async () => {
    listOutboxEventsMock.mockResolvedValue([
      { id: 'e2', entityType: 'credential', entityId: 'c2', action: 'credential.revealed', metadata: {}, occurredAt: '2026-09-10T00:00:00.000Z' },
    ])
    apiFetchMock.mockRejectedValue(new Error('offline'))

    await flushOutbox()

    expect(deleteOutboxEventMock).not.toHaveBeenCalled()
  })
})
