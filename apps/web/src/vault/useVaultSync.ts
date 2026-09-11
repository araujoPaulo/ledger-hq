import { useEffect } from 'react'
import { useOnlineStatus } from '../shell/useOnlineStatus'
import { useSession } from '../auth/session'
import { flushOutbox } from './outbox'
import { syncVault } from './sync'

/** Opportunistic cache refresh and outbox flush: whenever online with a session, catch both up. */
export function useVaultSync(): void {
  const online = useOnlineStatus()
  const session = useSession()
  const ready = online && session.isSuccess

  useEffect(() => {
    if (ready) {
      syncVault().catch(() => {})
      flushOutbox().catch(() => {})
    }
  }, [ready])
}
