import { useEffect } from 'react'
import { useOnlineStatus } from '../shell/useOnlineStatus'
import { useSession } from '../auth/session'
import { syncVault } from './sync'

/** Opportunistic cache refresh: whenever the app is online with a session, catch the offline cache up. */
export function useVaultSync(): void {
  const online = useOnlineStatus()
  const session = useSession()
  const ready = online && session.isSuccess

  useEffect(() => {
    if (ready) syncVault().catch(() => {})
  }, [ready])
}
