import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { encryptCredentialItem, toBase64 } from '@ledger-hq/crypto'
import { credentialItemSchema } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { createCredential } from './api'
import type { PlatformResponse } from './api'
import { useVaultState } from './vault-session'

type Props = { clientId: string; platforms: PlatformResponse[]; onCreated: () => void }

export function AddCredentialForm({ clientId, platforms, onCreated }: Props) {
  const { t } = useTranslation(['vault', 'common'])
  const vaultState = useVaultState()
  const [platformId, setPlatformId] = useState(platforms[0]?.id ?? '')
  const [label, setLabel] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpSecret, setTotpSecret] = useState('')

  const mutation = useMutation({
    mutationFn: async () => {
      if (vaultState.status !== 'unlocked') throw new Error('vault locked')

      const item = credentialItemSchema.parse({
        ...(username === '' ? {} : { username }),
        ...(password === '' ? {} : { password }),
        ...(totpSecret === '' ? {} : { totpSecret }),
      })
      const { ciphertext, iv } = await encryptCredentialItem(vaultState.key, item)

      return createCredential({ clientId, platformId, label, ciphertext: toBase64(ciphertext), iv: toBase64(iv) })
    },
    onSuccess: () => {
      setLabel('')
      setUsername('')
      setPassword('')
      setTotpSecret('')
      onCreated()
    },
  })

  if (platforms.length === 0) return null

  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <h3 className="font-medium">{t('vault:credentials.newTitle')}</h3>

      <label className="flex flex-col gap-1 text-sm">
        {t('vault:credentials.form.platform.label')}
        <select
          value={platformId}
          onChange={(event) => setPlatformId(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          {platforms.map((platform) => (
            <option key={platform.id} value={platform.id}>
              {platform.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('vault:credentials.form.label.label')}
        <input
          required
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('vault:credentials.form.username.label')}
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('vault:credentials.form.password.label')}
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('vault:credentials.form.totpSecret.label')}
        <input
          value={totpSecret}
          onChange={(event) => setTotpSecret(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1 font-mono"
        />
      </label>

      <ErrorMessage error={mutation.error} />

      <button
        type="submit"
        disabled={mutation.isPending}
        className="self-start rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {t('common:actions.create')}
      </button>
    </form>
  )
}
