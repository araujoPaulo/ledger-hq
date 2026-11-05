import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { encryptCredentialItem, toBase64 } from '@ledger-hq/crypto'
import { credentialItemSchema } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Dialog, Input, Select } from '../ui'
import { createCredential } from './api'
import type { PlatformResponse } from './api'
import { useVaultState } from './vault-session'

type Props = { clientId: string; platforms: PlatformResponse[]; onCreated: () => void }

/** Renders inside the New credential dialog; encrypts on this device before anything is sent. */
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
    onSuccess: () => onCreated(),
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <Select
        label={t('vault:credentials.form.platform.label')}
        value={platformId}
        onChange={(event) => setPlatformId(event.target.value)}
      >
        {platforms.map((platform) => (
          <option key={platform.id} value={platform.id}>
            {platform.name}
          </option>
        ))}
      </Select>
      <Input required label={t('vault:credentials.form.label.label')} value={label} onChange={(event) => setLabel(event.target.value)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          autoComplete="off"
          label={t('vault:credentials.form.username.label')}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <Input
          type="password"
          autoComplete="new-password"
          label={t('vault:credentials.form.password.label')}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <Input
        autoComplete="off"
        spellCheck={false}
        label={t('vault:credentials.form.totpSecret.label')}
        value={totpSecret}
        onChange={(event) => setTotpSecret(event.target.value)}
        className="font-mono"
      />

      <ErrorMessage error={mutation.error} />

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="primary" type="submit" isLoading={mutation.isPending}>
          {t('common:actions.create')}
        </Button>
      </Dialog.Footer>
    </form>
  )
}
