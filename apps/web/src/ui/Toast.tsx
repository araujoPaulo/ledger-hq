import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import * as RadixToast from '@radix-ui/react-toast'
import { useTranslation } from 'react-i18next'
import { Check, Info } from 'lucide-react'

type ToastTone = 'neutral' | 'success'
type ToastInput = { title: string; tone?: ToastTone | undefined }
type ToastItem = { id: number; title: string; tone: ToastTone }

const TOAST_DURATION_MS = 4_000
/** Enough to see a burst of copies acknowledged, not enough to build a column. */
const MAX_VISIBLE = 3

const ToastContext = createContext<((input: ToastInput) => void) | null>(null)

let nextId = 0

/**
 * Mounted once, in `AppLayout`. Only for confirming something with no other
 * visible result — a copy to the clipboard. A dialog that closes and a list
 * that updates is its own confirmation.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common')
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((input: ToastInput) => {
    nextId += 1
    const item: ToastItem = { id: nextId, title: input.title, tone: input.tone ?? 'neutral' }
    setToasts((current) => [...current.slice(-(MAX_VISIBLE - 1)), item])
  }, [])

  function remove(id: number) {
    setToasts((current) => current.filter((item) => item.id !== id))
  }

  return (
    // "background" makes Radix announce politely, not assertively.
    <RadixToast.Provider duration={TOAST_DURATION_MS} label={t('notifications')} swipeDirection="right">
      <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>

      {toasts.map((item) => {
        const Icon = item.tone === 'success' ? Check : Info
        return (
          <RadixToast.Root
            key={item.id}
            type="background"
            onOpenChange={(open) => {
              if (!open) remove(item.id)
            }}
            className="flex items-center gap-2 rounded-surface bg-ink px-4 py-3 text-sm text-white shadow-overlay"
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            <RadixToast.Title>{item.title}</RadixToast.Title>
          </RadixToast.Root>
        )
      })}

      {/* Bottom-centre on a phone, lifted above the tab bar; bottom-right from md. */}
      <RadixToast.Viewport
        label={`${t('notifications')} ({hotkey})`}
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 outline-none md:bottom-6 md:left-auto md:right-6 md:translate-x-0"
      />
    </RadixToast.Provider>
  )
}

export function useToast(): { toast: (input: ToastInput) => void } {
  const toast = useContext(ToastContext)
  if (toast === null) throw new Error('useToast must be used inside ToastProvider')
  return { toast }
}
