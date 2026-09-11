import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AUTH_KIND_VALUES } from '@ledger-hq/domain'
import type { AuthKind } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { createPlatform, listPlatforms } from './api'

export function PlatformsPage() {
  const { t } = useTranslation(['vault', 'domain', 'common'])
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [authKind, setAuthKind] = useState<AuthKind>('PASSWORD')

  const platforms = useQuery({ queryKey: ['platforms'], queryFn: listPlatforms })

  const mutation = useMutation({
    mutationFn: () => createPlatform({ name, url: url === '' ? undefined : url, authKind }),
    onSuccess: async () => {
      setName('')
      setUrl('')
      await queryClient.invalidateQueries({ queryKey: ['platforms'] })
    },
  })

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">{t('vault:platforms.title')}</h1>

      {platforms.isPending ? null : platforms.isError ? (
        <ErrorMessage error={platforms.error} />
      ) : platforms.data.length === 0 ? (
        <p className="text-sm text-slate-500">{t('vault:platforms.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {platforms.data.map((platform) => (
            <li key={platform.id} className="rounded border border-slate-200 bg-white p-3 text-sm">
              <span className="font-medium">{platform.name}</span>{' '}
              <span className="text-slate-500">{t(`domain:authKind.${platform.authKind}`)}</span>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex max-w-sm flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <h2 className="font-medium">{t('vault:platforms.newTitle')}</h2>

        <label className="flex flex-col gap-1 text-sm">
          {t('vault:platforms.form.name.label')}
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t('vault:platforms.form.url.label')}
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t('vault:platforms.form.authKind.label')}
          <select
            value={authKind}
            onChange={(event) => setAuthKind(event.target.value as AuthKind)}
            className="rounded border border-slate-300 px-2 py-1"
          >
            {AUTH_KIND_VALUES.map((value) => (
              <option key={value} value={value}>
                {t(`domain:authKind.${value}`)}
              </option>
            ))}
          </select>
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
    </section>
  )
}
