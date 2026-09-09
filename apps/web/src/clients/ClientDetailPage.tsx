import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { LegalForm } from '@ledger-hq/domain'
import { ApiError } from '../api/client'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { archiveClient, getClient, getFiscalProfile, restoreClient } from './api'
import { FiscalProfileForm } from './FiscalProfileForm'

export function ClientDetailPage() {
  const { clientId } = useParams({ from: '/clients/$clientId' })
  const { t, i18n } = useTranslation(['clients', 'common', 'domain'])
  const queryClient = useQueryClient()

  const client = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => getClient(clientId),
  })

  // A brand-new client has no fiscal profile row yet: GET returns
  // common.not_found in that case, which is an expected state here, not a
  // failure to retry.
  const fiscalProfile = useQuery({
    queryKey: ['fiscal-profile', clientId],
    queryFn: () => getFiscalProfile(clientId),
    retry: false,
    enabled: client.data !== undefined,
  })

  const archiveMutation = useMutation({
    mutationFn: () => archiveClient(clientId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['client', clientId] })
    },
  })

  const restoreMutation = useMutation({
    mutationFn: () => restoreClient(clientId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['client', clientId] })
    },
  })

  if (client.isPending) return null
  if (client.isError) return <ErrorMessage error={client.error} />

  const record = client.data
  const profileMissing =
    fiscalProfile.error instanceof ApiError && fiscalProfile.error.code === 'common.not_found'
  // A genuine fetch failure (a real 500, or the browser going offline) must
  // not be indistinguishable from "no profile exists yet": rendering the
  // form with defaults in that case would let a submit silently overwrite a
  // profile that merely failed to load, with no ErrorMessage in sight.
  const profileFailed = fiscalProfile.isError && !profileMissing

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{record.name}</h1>
          <p className="text-sm text-slate-500">{t(`domain:clientKind.${record.kind}`)}</p>
        </div>

        {record.archivedAt === null ? (
          <button
            type="button"
            onClick={() => archiveMutation.mutate()}
            disabled={archiveMutation.isPending}
            className="rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
          >
            {t('common:actions.archive')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => restoreMutation.mutate()}
            disabled={restoreMutation.isPending}
            className="rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
          >
            {t('common:actions.restore')}
          </button>
        )}
      </header>

      <ErrorMessage error={archiveMutation.error} />
      <ErrorMessage error={restoreMutation.error} />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded border border-slate-200 bg-white p-4 text-sm">
        <dt className="text-slate-500">{t('clients:form.taxId.label')}</dt>
        <dd>{record.taxId}</dd>

        <dt className="text-slate-500">{t('clients:form.accounting.label')}</dt>
        <dd>{t(`domain:accounting.${record.accounting}`)}</dd>

        {record.legalForm !== null && (
          <>
            <dt className="text-slate-500">{t('clients:form.legalForm.label')}</dt>
            {/* Guaranteed non-null only for a COMPANY, whose legalForm is always one of LEGAL_FORM_VALUES. */}
            <dd>{t(`domain:legalForm.${record.legalForm as LegalForm}`)}</dd>
          </>
        )}

        {record.socialSecurityNo !== null && (
          <>
            <dt className="text-slate-500">{t('clients:form.socialSecurityNo.label')}</dt>
            <dd>{record.socialSecurityNo}</dd>
          </>
        )}

        {record.dateOfBirth !== null && (
          <>
            <dt className="text-slate-500">{t('clients:form.dateOfBirth.label')}</dt>
            <dd>{formatDate(record.dateOfBirth, i18n.language as SupportedLocale)}</dd>
          </>
        )}

        {record.email !== null && (
          <>
            <dt className="text-slate-500">{t('clients:form.email.label')}</dt>
            <dd>{record.email}</dd>
          </>
        )}

        {record.phone !== null && (
          <>
            <dt className="text-slate-500">{t('clients:form.phone.label')}</dt>
            <dd>{record.phone}</dd>
          </>
        )}

        {record.notes !== null && (
          <>
            <dt className="text-slate-500">{t('clients:form.notes.label')}</dt>
            <dd>{record.notes}</dd>
          </>
        )}
      </dl>

      {fiscalProfile.isPending ? null : profileFailed ? (
        <ErrorMessage error={fiscalProfile.error} />
      ) : (
        <FiscalProfileForm clientId={clientId} kind={record.kind} initial={fiscalProfile.data ?? null} />
      )}
    </section>
  )
}
