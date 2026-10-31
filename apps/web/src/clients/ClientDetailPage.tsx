import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { LegalForm } from '@ledger-hq/domain'
import { Button } from '../ui'
import { ErrorMessage } from '../shell/ErrorMessage'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { archiveClient, getClient, restoreClient } from './api'
import { FiscalProfileCard } from './FiscalProfileCard'
import { EmploymentSection } from '../employments/EmploymentSection'
import { CredentialsSection } from '../vault/CredentialsSection'
import { ObligationsSection } from '../obligations/ObligationsSection'
import { ClientLedgerSection } from '../billing/ClientLedgerSection'

export function ClientDetailPage() {
  const { clientId } = useParams({ from: '/clients/$clientId' })
  const { t, i18n } = useTranslation(['clients', 'common', 'domain'])
  const queryClient = useQueryClient()

  const client = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => getClient(clientId),
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
  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{record.name}</h1>
          <p className="text-sm text-slate-500">{t(`domain:clientKind.${record.kind}`)}</p>
        </div>

        <div className="flex items-center gap-4">
          {record.archivedAt === null ? (
            <>
              <Button asChild variant="secondary">
                <Link to="/clients/$clientId/edit" params={{ clientId }}>
                  {t('common:actions.edit')}
                </Link>
              </Button>
              <Button variant="secondary" onClick={() => archiveMutation.mutate()} isLoading={archiveMutation.isPending}>
                {t('common:actions.archive')}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => restoreMutation.mutate()} isLoading={restoreMutation.isPending}>
              {t('common:actions.restore')}
            </Button>
          )}
        </div>
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

      <FiscalProfileCard clientId={clientId} kind={record.kind} />

      <ObligationsSection clientId={clientId} />
      <ClientLedgerSection clientId={clientId} />

      <EmploymentSection client={{ id: record.id, kind: record.kind, name: record.name }} />
      <CredentialsSection clientId={clientId} />
    </section>
  )
}
