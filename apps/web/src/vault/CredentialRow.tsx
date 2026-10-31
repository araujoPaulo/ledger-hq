import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Copy } from 'lucide-react'
import { decryptCredentialItem, encryptCredentialItem, fromBase64, generateTotp, toBase64 } from '@ledger-hq/crypto'
import type { CredentialItem } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Button, DataList, Dialog, Input, useToast } from '../ui'
import { rotateCredential } from './api'
import type { CredentialResponse } from './api'
import { recordReveal } from './outbox'
import { PlatformAvatar } from './PlatformAvatar'
import { useVaultState } from './vault-session'

type Props = { credential: CredentialResponse; platformName: string; onRotated: () => void }

const CLIPBOARD_CLEAR_MS = 30_000
const PASSWORD_MASK = '••••••••'
const TOTP_STEP_SECONDS = 30

/** Clears the clipboard 30 seconds after copying a secret — "to the extent the browser permits" (spec 9.4). */
async function copyAndClear(value: string): Promise<void> {
  await navigator.clipboard.writeText(value)
  setTimeout(() => {
    navigator.clipboard.writeText('').catch(() => {})
  }, CLIPBOARD_CLEAR_MS)
}

/**
 * A plain copy, for a username: not a secret, so no clear. Async so a missing
 * clipboard API (plain HTTP) rejects rather than throwing synchronously.
 */
async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value)
}

function secondsLeftInStep(): number {
  return TOTP_STEP_SECONDS - (Math.floor(Date.now() / 1000) % TOTP_STEP_SECONDS)
}

export function CredentialRow({ credential, platformName, onRotated }: Props) {
  const { t, i18n } = useTranslation(['vault', 'common'])
  const { toast } = useToast()
  const vaultState = useVaultState()
  const [item, setItem] = useState<CredentialItem | null>(null)
  const [totp, setTotp] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(secondsLeftInStep)
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
    // One tick refreshes both the code and the seconds left in its step.
    const tick = () => {
      setSecondsLeft(secondsLeftInStep())
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

  // A copy that did not happen (no clipboard API, or a denied write) gets no
  // toast — a "copied" message for a copy that failed is worse than silence.
  function copyPassword(password: string) {
    copyAndClear(password)
      .then(() => toast({ title: t('vault:credentials.passwordCopied'), tone: 'success' }))
      .catch(() => {})
  }

  function copyUsername(username: string) {
    copyText(username)
      .then(() => toast({ title: t('vault:credentials.usernameCopied'), tone: 'success' }))
      .catch(() => {})
  }

  return (
    <li className="flex flex-col gap-4 px-5 py-3">
      <div className="flex items-center gap-4">
        <PlatformAvatar name={platformName} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{platformName}</span>
          <span className="truncate text-xs text-muted">
            {credential.label} ·{' '}
            {t('vault:credentials.changed', {
              date: formatDate(credential.updatedAt.slice(0, 10), i18n.language as SupportedLocale),
            })}
          </span>
        </div>
        {item === null ? (
          <Button variant="secondary" size="sm" onClick={() => void reveal()}>
            {t('vault:credentials.reveal')}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setItem(null)}>
            {t('vault:credentials.hide')}
          </Button>
        )}
      </div>

      {item !== null && (
        <div className="flex flex-col gap-4 md:pl-12">
          <DataList as="dl">
            {item.username !== undefined && (
              <DataList.Row
                label={t('vault:credentials.form.username.label')}
                value={
                  <>
                    <span className="truncate">{item.username}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('vault:credentials.copyUsername')}
                      onClick={() => copyUsername(item.username ?? '')}
                    >
                      <Copy aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </>
                }
              />
            )}
            {item.password !== undefined && (
              // Never rendered in clear: a mask, Copy, and the clear stated where it happens.
              <DataList.Row
                label={t('vault:credentials.form.password.label')}
                value={
                  <>
                    <span className="font-mono">{PASSWORD_MASK}</span>
                    <Button variant="secondary" size="sm" onClick={() => copyPassword(item.password ?? '')}>
                      {t('vault:credentials.copy')}
                    </Button>
                    <span className="text-xs text-muted">{t('vault:credentials.clipboardClears')}</span>
                  </>
                }
              />
            )}
            {totp !== null && (
              // Not a live region: announcing every second would make the page
              // unusable with a screen reader (spec §10.4).
              <DataList.Row
                label={t('vault:credentials.totp')}
                value={
                  <>
                    <span className="font-mono text-lg tabular-nums">{`${totp.slice(0, 3)} ${totp.slice(3)}`}</span>
                    <span className="text-xs text-muted tabular-nums">
                      {t('vault:credentials.secondsLeft', { seconds: secondsLeft })}
                    </span>
                  </>
                }
              />
            )}
          </DataList>
          {item.notes !== undefined && <p className="whitespace-pre-line text-sm font-normal">{item.notes}</p>}
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setRotating(true)}>
            {t('vault:credentials.rotate')}
          </Button>
        </div>
      )}

      <Dialog
        open={rotating}
        onOpenChange={(open) => {
          setRotating(open)
          if (!open) setNewPassword('')
        }}
      >
        <Dialog.Content title={t('vault:credentials.rotate')} size="sm">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (newPassword === '') return
              rotateMutation.mutate()
            }}
          >
            <Input
              type="password"
              autoComplete="new-password"
              required
              label={t('vault:credentials.form.password.label')}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <ErrorMessage error={rotateMutation.error} />
            <Dialog.Footer>
              <Dialog.Close asChild>
                <Button variant="ghost">{t('common:actions.cancel')}</Button>
              </Dialog.Close>
              <Button variant="primary" type="submit" isLoading={rotateMutation.isPending} disabled={newPassword === ''}>
                {t('vault:credentials.rotateConfirm')}
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      </Dialog>
    </li>
  )
}
