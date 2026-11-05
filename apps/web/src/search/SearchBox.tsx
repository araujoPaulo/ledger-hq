import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { Input } from '../ui'

/** The shell's only text input, so it owns the `/` shortcut. */
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
    <div className="px-2">
      <Input
        ref={inputRef}
        type="search"
        leadingIcon={Search}
        hideLabel
        label={t('search.label')}
        placeholder={t('search.placeholder')}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          setValue('')
          event.currentTarget.blur()
        }}
        // 36px to sit in the sidebar; `!` because Input's own height is h-10.
        className="h-9!"
      />
    </div>
  )
}
