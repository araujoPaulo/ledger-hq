import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Globe, Lock, LockOpen, Plus, ShieldAlert } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { useSession } from '../auth/session'
import { Badge, Button, Callout, Card, DataList, Dialog, EmptyState, PageHeader } from '../ui'
import { listPlatforms } from './api'
import { NewPlatformForm } from './NewPlatformForm'
import { PlatformAvatar } from './PlatformAvatar'
import { PlatformsPageSkeleton } from './PlatformsPageSkeleton'
import { resolveEnvelope } from './unlock'
import { INACTIVITY_LOCK_MS, useVaultState } from './vault-session'

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

const LOCK_MINUTES = INACTIVITY_LOCK_MS / 60_000

/**
 * Status about the app, not about a record — hence a pill. Driven by the
 * vault store, so it flips the moment auto-lock fires. Not a live region:
 * a lock that happens while the reader is elsewhere is explained by the
 * credentials gate when they get there.
 */
function VaultStatusPill() {
  const { t } = useTranslation('vault')
  const vaultState = useVaultState()

  return vaultState.status === 'unlocked' ? (
    <Badge shape="pill" tone="success">
      <LockOpen aria-hidden="true" className="h-3.5 w-3.5" />
      {t('status.unlocked', { minutes: LOCK_MINUTES })}
    </Badge>
  ) : (
    <Badge shape="pill" tone="neutral">
      <Lock aria-hidden="true" className="h-3.5 w-3.5" />
      {t('status.locked')}
    </Badge>
  )
}

export function PlatformsPage() {
  const { t } = useTranslation(['vault', 'domain', 'common'])
  const [creating, setCreating] = useState(false)
  const headingId = useId()

  const platforms = useQuery({ queryKey: ['platforms'], queryFn: listPlatforms })

  const session = useSession()
  const email = session.data?.email ?? ''
  const vaultState = useVaultState()

  // The unlock gate's own query and key, so this page adds no request shape:
  // the same cache entry answers both.
  const envelope = useQuery({
    queryKey: ['vault-envelope-resolved', email],
    queryFn: () => resolveEnvelope(email),
    enabled: email !== '' && vaultState.status === 'locked',
  })

  // An unlocked vault is set up by definition. Requiring "locked" as well
  // keeps an envelope cached before setup from prompting for a vault that
  // now exists. `null` (unknown offline) and pending both mean "say nothing".
  const notSetUp = vaultState.status === 'locked' && envelope.data?.setUp === false

  return (
    // The Root wraps the page so the header button can be the dialog's
    // Trigger: focus returns to it when the dialog closes.
    <Dialog open={creating} onOpenChange={setCreating}>
      <div className="flex flex-col gap-8">
        <PageHeader
          title={t('common:nav.vault')}
          description={t('vault:platforms.description')}
          actions={
            <>
              <VaultStatusPill />
              <Dialog.Trigger asChild>
                <Button variant="primary">
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  {t('vault:platforms.newTitle')}
                </Button>
              </Dialog.Trigger>
            </>
          }
        />

        {notSetUp && (
          <Callout
            tone="neutral"
            icon={ShieldAlert}
            action={
              <Button asChild size="sm" variant="secondary">
                <Link to="/vault/setup">{t('vault:unlock.setUpLink')}</Link>
              </Button>
            }
          >
            {t('vault:unlock.notSetUp')}
          </Callout>
        )}

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
