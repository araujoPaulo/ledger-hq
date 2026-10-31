/** The first letters of a platform name's first and last words; two letters of a one-word name. */
export function platformInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== '')
  const first = words[0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1] ?? '') : ''
  const initials = last === '' ? first.slice(0, 2) : `${first.slice(0, 1)}${last.slice(0, 1)}`
  return initials.toUpperCase()
}

/** Shared with the Vault page. The name is always printed beside it, so it is decorative. */
export function PlatformAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-accent-50 text-xs font-semibold text-accent-700"
    >
      {platformInitials(name)}
    </span>
  )
}
