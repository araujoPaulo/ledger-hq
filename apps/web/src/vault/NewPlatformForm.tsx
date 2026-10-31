import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AUTH_KIND_VALUES } from '@ledger-hq/domain'
import type { AuthKind } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Dialog, Input, Select } from '../ui'
import { createPlatform } from './api'

type Props = { onCreated: () => void }

/** The create form, moved out of the page. Renders inside `Dialog.Content`. */
export function NewPlatformForm({ onCreated }: Props) {
  const { t } = useTranslation(['vault', 'domain', 'common'])
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [authKind, setAuthKind] = useState<AuthKind>('PASSWORD')

  const mutation = useMutation({
    mutationFn: () => createPlatform({ name, url: url === '' ? undefined : url, authKind }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platforms'] })
      onCreated()
    },
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <Input
        label={t('vault:platforms.form.name.label')}
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        type="url"
        label={t('vault:platforms.form.url.label')}
        placeholder="https://"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
      />
      <Select
        label={t('vault:platforms.form.authKind.label')}
        value={authKind}
        onChange={(event) => setAuthKind(event.target.value as AuthKind)}
      >
        {AUTH_KIND_VALUES.map((value) => (
          <option key={value} value={value}>
            {t(`domain:authKind.${value}`)}
          </option>
        ))}
      </Select>

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
