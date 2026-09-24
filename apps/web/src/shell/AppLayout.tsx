import { Outlet } from '@tanstack/react-router'
import { ConnectionStatus } from './ConnectionStatus'
import { Sidebar } from './Sidebar'
import { MobileTabBar, MobileTopBar } from './MobileNav'
import { RequireSession } from '../router'
import { useVaultSync } from '../vault/useVaultSync'

export function AppLayout() {
  useVaultSync()

  return (
    <div className="flex min-h-dvh bg-ground text-ink">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar />

        <div className="hidden justify-end px-6 pt-6 md:flex">
          <ConnectionStatus />
        </div>

        {/* pb-24 keeps the fixed tab bar off the last row of content. */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 md:px-6 md:pb-8">
          <RequireSession>
            <Outlet />
          </RequireSession>
        </main>

        <MobileTabBar />
      </div>
    </div>
  )
}
