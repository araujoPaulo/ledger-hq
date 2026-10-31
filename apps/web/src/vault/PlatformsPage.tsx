import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Button, Dialog, PageHeader } from '../ui'
import { listPlatforms } from './api'
import { NewPlatformForm } from './NewPlatformForm'

export function PlatformsPage() {
  const { t } = useTranslation(['vault', 'domain', 'common'])
  const [creating, setCreating] = useState(false)

  const platforms = useQuery({ queryKey: ['platforms'], queryFn: listPlatforms })

  return (
    // The Root wraps the page so the header button can be the dialog's
    // Trigger: focus returns to it when the dialog closes.
    <Dialog open={creating} onOpenChange={setCreating}>
      <div className="flex flex-col gap-8">
        <PageHeader
          title={t('common:nav.vault')}
          description={t('vault:platforms.description')}
          actions={
            <Dialog.Trigger asChild>
              <Button variant="primary">
                <Plus aria-hidden="true" className="h-4 w-4" />
                {t('vault:platforms.newTitle')}
              </Button>
            </Dialog.Trigger>
          }
        />

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{t('vault:platforms.title')}</h2>

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
        </section>
      </div>

      <Dialog.Content title={t('vault:platforms.newTitle')}>
        <NewPlatformForm onCreated={() => setCreating(false)} />
      </Dialog.Content>
    </Dialog>
  )
}
