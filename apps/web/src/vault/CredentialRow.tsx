import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { decryptCredentialItem, encryptCredentialItem, fromBase64, generateTotp, toBase64 } from '@ledger-hq/crypto'
import type { CredentialItem } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { rotateCredential } from './api'
import type { CredentialResponse } from './api'
import { recordReveal } from './outbox'
import { useVaultState } from './vault-session'

type Props = { credential: CredentialResponse; platformName: string; onRotated: () => void }

const CLIPBOARD_CLEAR_MS = 30_000
const PASSWORD_MASK = '••••••••'

/** Clears the clipboard 30 seconds after copying a secret — "to the extent the browser permits" (spec 9.4). */
async function copyAndClear(value: string): Promise<void> {
  await navigator.clipboard.writeText(value)
  setTimeout(() => {
    navigator.clipboard.writeText('').catch(() => {})
  }, CLIPBOARD_CLEAR_MS)
}

export function CredentialRow({ credential, platformName, onRotated }: Props) {
  const { t } = useTranslation('vault')
  const vaultState = useVaultState()
  const [item, setItem] = useState<CredentialItem | null>(null)
  const [totp, setTotp] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)
  const [newPassword, setNewPassword] = useState('')

  async function reveal(): Promise<void> {
    if (vaultState.status !== 'unlocked') return
    const decrypted = await decryptCredentialItem(vaultState.key, fromBase64(credential.ciphertext), fromBase64(credential.iv))
    setItem(decrypted as CredentialItem)
    void recordReveal(credential.id)
  }

  // Spec 9.4: "Locking releases the reference and clears cached plaintext."
  // Auto-lock (Task 10) only drops the CryptoKey — anything already
  // revealed on screen must be cleared independently, or a credential
  // stays visible past the inactivity window that was supposed to hide it.
  useEffect(() => {
    if (vaultState.status === 'locked') setItem(null)
  }, [vaultState.status])

  useEffect(() => {
    const secret = item?.totpSecret
    if (secret === undefined) {
      setTotp(null)
      return
    }

    let cancelled = false
    const tick = () => {
      generateTotp(secret).then((code) => {
        if (!cancelled) setTotp(code)
      })
    }
    tick()
    const interval = setInterval(tick, 1000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [item?.totpSecret])

  const rotateMutation = useMutation({
    mutationFn: async () => {
      if (vaultState.status !== 'unlocked' || item === null) throw new Error('vault locked')
      const { ciphertext, iv } = await encryptCredentialItem(vaultState.key, { ...item, password: newPassword })
      return rotateCredential(credential.id, { ciphertext: toBase64(ciphertext), iv: toBase64(iv) })
    },
    onSuccess: () => {
      setRotating(false)
      setNewPassword('')
      setItem(null)
      onRotated()
    },
  })

  return (
    <li className="rounded border border-slate-200 bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">
          {platformName} — {credential.label}
        </span>
        {item === null ? (
          <button type="button" onClick={reveal} className="rounded border border-slate-300 px-2 py-1 text-xs">
            {t('credentials.reveal')}
          </button>
        ) : (
          <button type="button" onClick={() => setItem(null)} className="rounded border border-slate-300 px-2 py-1 text-xs">
            {t('credentials.hide')}
          </button>
        )}
      </div>

      {item !== null && (
        <div className="mt-2 flex flex-col gap-1">
          {item.username !== undefined && (
            <p>
              {t('credentials.form.username.label')}: {item.username}
            </p>
          )}
          {item.password !== undefined && (
            <p className="flex items-center gap-2">
              {t('credentials.form.password.label')}: {PASSWORD_MASK}
              <button type="button" onClick={() => void copyAndClear(item.password ?? '')} className="text-xs underline">
                {t('credentials.copy')}
              </button>
            </p>
          )}
          {totp !== null && (
            <p className="font-mono">
              {t('credentials.totp')}: {totp}
            </p>
          )}
          {item.notes !== undefined && <p className="text-slate-600">{item.notes}</p>}

          {rotating ? (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="rounded border border-slate-300 px-2 py-1"
              />
              <button
                type="button"
                onClick={() => rotateMutation.mutate()}
                disabled={rotateMutation.isPending}
                className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
              >
                {t('credentials.rotateConfirm')}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setRotating(true)} className="mt-2 self-start text-xs underline">
              {t('credentials.rotate')}
            </button>
          )}

          <ErrorMessage error={rotateMutation.error} />
        </div>
      )}
    </li>
  )
}
