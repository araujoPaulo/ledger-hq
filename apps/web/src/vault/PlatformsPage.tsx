import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Globe, Plus } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Badge, Button, Card, DataList, Dialog, EmptyState, PageHeader } from '../ui'
import { listPlatforms } from './api'
import { NewPlatformForm } from './NewPlatformForm'
import { PlatformAvatar } from './PlatformAvatar'
import { PlatformsPageSkeleton } from './PlatformsPageSkeleton'

/**
 * The host is all a reader needs to recognise a platform. A stored URL that
 * does not parse (no scheme, say) is shown as stored rather than dropped.
 */
function hostOf(url: string): string {
  try {
    const parsed = new URL(url)
    // `localhost:8080` parses as scheme `localhost:` with no host.
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host !== '' ? parsed.host : url
  } catch {
    return url
  }
}

export function PlatformsPage() {
  const { t } = useTranslation(['vault', 'domain', 'common'])
  const [creating, setCreating] = useState(false)
  const headingId = useId()

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

        <section aria-labelledby={headingId} className="flex flex-col gap-4">
          <h2 id={headingId} className="text-lg font-semibold">
            {t('vault:platforms.title')}
          </h2>

          {platforms.isPending ? (
            <PlatformsPageSkeleton />
          ) : platforms.isError ? (
            <ErrorMessage error={platforms.error} />
          ) : platforms.data.length === 0 ? (
            <EmptyState
              icon={Globe}
              title={t('vault:platforms.empty')}
              description={t('vault:platforms.emptyHint')}
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  {t('vault:platforms.newTitle')}
                </Button>
              }
            />
          ) : (
            <Card padding="none" className="px-5">
              <DataList>
                {platforms.data.map((platform) => (
                  <DataList.Row
                    key={platform.id}
                    wrap
                    label={
                      <span className="flex items-center gap-4">
                        <PlatformAvatar name={platform.name} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{platform.name}</span>
                          {platform.url !== null && (
                            // Plain text, not a link: the row is about the
                            // record, and a stray click should not leave the app.
                            <span className="truncate text-xs text-muted">{hostOf(platform.url)}</span>
                          )}
                        </span>
                      </span>
                    }
                    value={<Badge tone="neutral">{t(`domain:authKind.${platform.authKind}`)}</Badge>}
                  />
                ))}
              </DataList>
            </Card>
          )}
        </section>
      </div>

      <Dialog.Content title={t('vault:platforms.newTitle')}>
        <NewPlatformForm onCreated={() => setCreating(false)} />
      </Dialog.Content>
    </Dialog>
  )
}
