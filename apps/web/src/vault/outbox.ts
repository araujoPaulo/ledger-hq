import { apiFetch } from '../api/client'
import { deleteOutboxEvent, listOutboxEvents, queueOutboxEvent } from './vault-db'

/**
 * Queues a credential-reveal audit event durably, then attempts an immediate
 * flush. Callers use this fire-and-forget (`void recordReveal(...)`), so it
 * never rejects itself — a failure here (offline, or IndexedDB unavailable)
 * must never surface as an unhandled rejection at the reveal call site; the
 * outbox is the durability mechanism, not this call.
 */
export async function recordReveal(credentialId: string): Promise<void> {
  try {
    await queueOutboxEvent({
      id: crypto.randomUUID(),
      entityType: 'credential',
      entityId: credentialId,
      action: 'credential.revealed',
      metadata: {},
      occurredAt: new Date().toISOString(),
    })
    await flushOutbox()
  } catch {
    // Best-effort: the event may not have been queued at all, but a reveal
    // that already happened must never be disrupted by an audit-trail fault.
  }
}

/** Uploads every queued event; a failed one (offline, most commonly) stays queued for the next attempt. */
export async function flushOutbox(): Promise<void> {
  const events = await listOutboxEvents()

  for (const event of events) {
    try {
      await apiFetch('/vault/audit-events', {
        method: 'POST',
        body: { entityType: event.entityType, entityId: event.entityId, action: event.action, metadata: event.metadata },
      })
      await deleteOutboxEvent(event.id)
    } catch {
      // Left in the outbox; the next flush (the next reveal, or `useVaultSync`
      // once the network returns) retries it.
    }
  }
}
