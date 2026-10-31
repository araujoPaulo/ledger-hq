import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { ClientKind } from '@ledger-hq/domain'
import { ApiError } from '../api/client'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { Badge, Button, Card, DataList, Dialog, Skeleton } from '../ui'
import { getFiscalProfile } from './api'
import type { FiscalProfileResponse } from './api'
import { FiscalProfileForm } from './FiscalProfileForm'

/** A list of four "No"s says nothing: only the flags that are on are shown. */
const FLAGS = ['hasOpenActivity', 'hasEmployees', 'hasWithholding', 'isVatCashBasis'] as const

function ProfileView({ profile }: { profile: FiscalProfileResponse }) {
  const { t, i18n } = useTranslation(['clients', 'domain'])
  const on = FLAGS.filter((flag) => profile[flag])

  return (
    <div className="flex flex-col gap-4">
      <DataList as="dl">
        <DataList.Row label={t('clients:profile.vatRegime')} value={t(`domain:vatRegime.${profile.vatRegime}`)} />
        <DataList.Row label={t('clients:profile.incomeTax')} value={t(`domain:incomeTax.${profile.incomeTax}`)} />
        <DataList.Row
          label={t('clients:profile.startedAt')}
          value={<span className="tabular-nums">{formatDate(profile.startedAt, i18n.language as SupportedLocale)}</span>}
        />
      </DataList>
      {on.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {on.map((flag) => (
            <Badge key={flag} tone="neutral">
              <Check aria-hidden="true" className="h-3.5 w-3.5" />
              {t(`clients:profile.${flag}`)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

export function FiscalProfileCard({ clientId, kind }: { clientId: string; kind: ClientKind }) {
  const { t } = useTranslation(['clients', 'common'])
  const titleId = useId()
  const [editing, setEditing] = useState(false)

  // A brand-new client has no fiscal profile row yet: GET returns
  // common.not_found in that case, which is an expected state here, not a
  // failure to retry.
  const profile = useQuery({
    queryKey: ['fiscal-profile', clientId],
    queryFn: () => getFiscalProfile(clientId),
    retry: false,
  })

  const missing = profile.error instanceof ApiError && profile.error.code === 'common.not_found'
  // A genuine fetch failure (a real 500, or the browser going offline) must
  // not be indistinguishable from "no profile exists yet": offering the form
  // with defaults in that case would let a submit silently overwrite a
  // profile that merely failed to load, with no ErrorMessage in sight.
  const failed = profile.isError && !missing
  const canEdit = !profile.isPending && !failed

  return (
    <section aria-labelledby={titleId}>
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-base font-semibold">
            {t('clients:profile.title')}
          </h2>
          {canEdit && (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              {missing ? t('clients:profile.setUp') : t('common:actions.edit')}
            </Button>
          )}
        </div>

        {profile.isPending ? (
          <div className="flex flex-col gap-4" aria-busy="true">
            <Skeleton height="0.875rem" />
            <Skeleton height="0.875rem" />
            <Skeleton width="60%" height="0.875rem" />
          </div>
        ) : failed ? (
          <ErrorMessage error={profile.error} />
        ) : missing || profile.data === undefined ? (
          <p className="text-sm font-normal text-muted">{t('clients:profile.empty')}</p>
        ) : (
          <ProfileView profile={profile.data} />
        )}
      </Card>

      <Dialog open={editing} onOpenChange={setEditing}>
        {canEdit && (
          <Dialog.Content title={t('clients:profile.title')}>
            <FiscalProfileForm
              clientId={clientId}
              kind={kind}
              initial={profile.data ?? null}
              onSaved={() => setEditing(false)}
            />
          </Dialog.Content>
        )}
      </Dialog>
    </section>
  )
}
