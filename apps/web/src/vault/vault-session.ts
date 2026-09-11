import { useSyncExternalStore } from 'react'

export type VaultState = { status: 'locked' } | { status: 'unlocked'; key: CryptoKey; unlockedAt: number }

const INACTIVITY_LOCK_MS = 5 * 60 * 1000

let state: VaultState = { status: 'locked' }
const listeners = new Set<() => void>()
let inactivityTimer: ReturnType<typeof setTimeout> | undefined

function notify(): void {
  for (const listener of listeners) listener()
}

export function getVaultState(): VaultState {
  return state
}

export function subscribeVaultState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useVaultState(): VaultState {
  return useSyncExternalStore(subscribeVaultState, getVaultState)
}

function resetInactivityTimer(): void {
  if (inactivityTimer) clearTimeout(inactivityTimer)
  inactivityTimer = setTimeout(lockVault, INACTIVITY_LOCK_MS)
}

export function unlockVault(key: CryptoKey): void {
  state = { status: 'unlocked', key, unlockedAt: Date.now() }
  resetInactivityTimer()
  notify()
}

export function lockVault(): void {
  state = { status: 'locked' }
  if (inactivityTimer) clearTimeout(inactivityTimer)
  notify()
}

/** Called on user interaction and on the tab becoming visible again. */
export function noteActivity(): void {
  if (state.status === 'unlocked') resetInactivityTimer()
}

if (typeof window !== 'undefined') {
  for (const eventName of ['pointerdown', 'keydown']) {
    window.addEventListener(eventName, noteActivity, { passive: true })
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) noteActivity()
  })
}
