import { useTranslation } from 'react-i18next'
import { Copy } from 'lucide-react'
import { Button, useToast } from '../ui'
import { copyAndClear } from './clipboard'

type Props = { code: string }

/**
 * The one text in the app a user copies down by hand. Each hyphen-separated
 * group is its own cell, so a group never breaks across a line and the
 * reader can keep their place. Base32 has no 0, 1, 8 or 9, so O/0 and I/1
 * cannot be confused; monospace still gives every character one shape.
 */
export function RecoveryCodeDisplay({ code }: Props) {
  const { t } = useTranslation('vault')
  const { toast } = useToast()
  const groups = code.split('-')

  async function copy(): Promise<void> {
    try {
      // A recovery code is a secret: same 30-second clear as a password.
      await copyAndClear(code)
    } catch {
      // No clipboard API (plain HTTP) or a denied write. Saying "copied"
      // would be a lie; the code stays on screen to copy by hand.
      return
    }
    toast({ title: t('setup.codeCopied'), tone: 'success' })
  }

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label={t('setup.recoveryCodeLabel')} className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {groups.map((group, index) => (
          <li
            key={`${index}-${group}`}
            className="rounded-control bg-ground px-3 py-2 text-center font-mono text-lg font-semibold tracking-widest tabular-nums"
          >
            {group}
          </li>
        ))}
      </ul>
      <Button variant="secondary" className="self-start" onClick={() => void copy()}>
        <Copy aria-hidden="true" className="h-4 w-4" />
        {t('setup.copyCode')}
      </Button>
    </div>
  )
}
