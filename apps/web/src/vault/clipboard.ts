export const CLIPBOARD_CLEAR_MS = 30_000

/**
 * Copies a secret and clears the clipboard 30 seconds later — "to the
 * extent the browser permits" (spec 9.4). Rejects when the write fails or
 * the clipboard API is absent (plain HTTP has none), so a caller never
 * reports a copy that did not happen; the clear is scheduled only after a
 * successful write. The later clear is best-effort and never rejects: by
 * then nobody is waiting on it.
 */
export async function copyAndClear(value: string): Promise<void> {
  await navigator.clipboard.writeText(value)
  setTimeout(() => {
    navigator.clipboard.writeText('').catch(() => {})
  }, CLIPBOARD_CLEAR_MS)
}
