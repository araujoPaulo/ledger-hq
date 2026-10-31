import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '../ui'
import { ConnectionStatus } from '../shell/ConnectionStatus'
import { LanguageMenu } from '../shell/LanguageMenu'

/** The sidebar's mark at 40px, so the shell that appears after sign-in is visibly the same product. */
export function AuthMark() {
  const { t } = useTranslation('common')

  return (
    <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-surface bg-accent-600 text-base font-semibold text-white"
      >
        L
      </span>
      {t('appName')}
    </span>
  )
}

type AuthFrameProps = { header?: ReactNode; busy?: boolean; children: ReactNode }

/**
 * Shared by the layout and the splash so the mark sits in exactly the same
 * place in both. The header keeps its 64px height even when empty, which is
 * what stops the mark jumping when the splash gives way to the card.
 *
 * On mobile the column starts near the top rather than centring, so the
 * on-screen keyboard does not push the submit button out of view.
 */
export function AuthFrame({ header, busy = false, children }: AuthFrameProps) {
  return (
    <div aria-busy={busy || undefined} className="flex min-h-dvh flex-col bg-ground text-ink">
      <header className="flex h-16 items-center justify-end gap-2 px-4">{header}</header>
      <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-[8vh] md:items-center md:pt-0">
        <div className="flex w-full max-w-sm flex-col items-center gap-6">{children}</div>
      </main>
    </div>
  )
}

/** The signed-out screens' layout: no shell, one card, language and connection always reachable. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <AuthFrame
      header={
        <>
          <ConnectionStatus />
          <LanguageMenu />
        </>
      }
    >
      <AuthMark />
      <Card className="w-full">{children}</Card>
    </AuthFrame>
  )
}
