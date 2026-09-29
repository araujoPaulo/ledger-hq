import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'

/**
 * The shell's only text input, so it owns the `/` shortcut.
 *
 * A plain `<input>` on purpose: `apps/web/src/ui/` has no `Input` yet — UI
 * refresh Stage 2 introduces it, designed against `ClientFormPage` rather
 * than against one search box. `ClientListPage`'s filter bar is the same
 * plain shape for the same reason; Stage 2 adopts both at once.
 */
export function SearchBox() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/') return

      // `/` is a literal character in any field the operator is typing in.
      // Stealing it there would make the box unusable and every other input
      // lossy.
      const active = document.activeElement
      const isTextField =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      if (isTextField) return

      event.preventDefault()
      inputRef.current?.focus()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (value.trim().length === 0) return

    // Debounced and `replace: true`: one history entry for a search, not one
    // per keystroke, so Back leaves the results rather than walking them.
    const timer = setTimeout(() => {
      void navigate({ to: '/search', search: { q: value }, replace: true })
    }, 200)

    return () => clearTimeout(timer)
  }, [value, navigate])

  return (
    <div className="relative px-2">
      <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
      <input
        ref={inputRef}
        type="search"
        aria-label={t('search.label')}
        placeholder={t('search.placeholder')}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          setValue('')
          event.currentTarget.blur()
        }}
        className="w-full rounded-control border border-line bg-ground py-1.5 pl-8 pr-2 text-sm placeholder:text-subtle"
      />
    </div>
  )
}
