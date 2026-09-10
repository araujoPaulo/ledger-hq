import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ERROR_CODES, createEmploymentSchema } from '@ledger-hq/domain'
import type { ClientKind, ErrorCode } from '@ledger-hq/domain'
import { ErrorMessage, translateErrorCode } from '../shell/ErrorMessage'
import { listClients } from '../clients/api'
import { createEmployment } from './api'

type Props = { client: { id: string; kind: ClientKind; name: string } }

type FormValues = {
  counterpartyId: string
  startedOn: string
  endedOn: string
  jobTitle: string
}

const initialValues: FormValues = { counterpartyId: '', startedOn: '', endedOn: '', jobTitle: '' }

/**
 * `createEmploymentSchema`'s cross-field refinements (self-employment,
 * ended-before-started) deliberately carry a domain `ErrorCode` as their
 * issue message — unlike `createClientSchema`'s refinements (see
 * ClientFormPage), which avoid that on purpose to not collide with the
 * server pipe's code-promotion mechanism. Format-only issues (an empty
 * required field, an invalid uuid) carry Zod's own plain issue codes and are
 * filtered out here rather than forced through `translateErrorCode`, which
 * only accepts genuine `ClientErrorCode`s: the UI instead prevents
 * submission of those via required fields and a disabled submit button.
 */
function isErrorCode(message: string): message is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(message)
}

function toCandidate(client: Props['client'], isCompany: boolean, values: FormValues): unknown {
  const employerId = isCompany ? client.id : values.counterpartyId
  const employeeId = isCompany ? values.counterpartyId : client.id

  return {
    employerId,
    employeeId,
    startedOn: values.startedOn,
    ...(values.endedOn.trim() === '' ? {} : { endedOn: values.endedOn }),
    ...(values.jobTitle.trim() === '' ? {} : { jobTitle: values.jobTitle }),
  }
}

export function AddEmploymentForm({ client }: Props) {
  const { t } = useTranslation(['employments', 'common'])
  const { t: tError } = useTranslation('errors')
  const queryClient = useQueryClient()
  const isCompany = client.kind === 'COMPANY'

  const [values, setValues] = useState<FormValues>(initialValues)

  const counterparties = useQuery({
    queryKey: ['clients', { kind: isCompany ? 'INDIVIDUAL' : 'COMPANY' }],
    queryFn: () => listClients({ kind: isCompany ? 'INDIVIDUAL' : 'COMPANY' }),
  })

  const parsed = createEmploymentSchema.safeParse(toCandidate(client, isCompany, values))
  const violations: ErrorCode[] = parsed.success
    ? []
    : parsed.error.issues.map((issue) => issue.message).filter(isErrorCode)

  const mutation = useMutation({
    mutationFn: () => {
      // Guarded by `canSubmit` at the only call site (the form's submit
      // handler), so this is never reached with `parsed.success === false`.
      if (!parsed.success) throw new Error('AddEmploymentForm: submitted with invalid input')
      return createEmployment(parsed.data)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employments', client.id] })
      setValues(initialValues)
    },
  })

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  const canSubmit =
    values.counterpartyId !== '' && values.startedOn !== '' && violations.length === 0 && parsed.success

  return (
    <form
      className="flex flex-col gap-3 rounded border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit) return
        mutation.mutate()
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        {isCompany ? t('employments:form.employee.label') : t('employments:form.employer.label')}
        <select
          value={values.counterpartyId}
          onChange={(event) => update('counterpartyId', event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          <option value="" disabled>
            {isCompany ? t('employments:form.employee.label') : t('employments:form.employer.label')}
          </option>
          {counterparties.data?.map((counterparty) => (
            <option key={counterparty.id} value={counterparty.id}>
              {counterparty.name}
            </option>
          ))}
        </select>
      </label>
      {/*
       * Without this, a failed fetch of eligible counterparties would look
       * identical to "none exist yet" — an empty dropdown with no
       * explanation — the same shape of bug the fiscal profile form used to
       * have before it was fixed to distinguish "no profile yet" from a
       * genuine fetch failure.
       */}
      {counterparties.isError ? <ErrorMessage error={counterparties.error} /> : null}

      <label className="flex flex-col gap-1 text-sm">
        {t('employments:form.startedOn.label')}
        <input
          type="date"
          value={values.startedOn}
          onChange={(event) => update('startedOn', event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('employments:form.endedOn.label')}
        <input
          type="date"
          value={values.endedOn}
          onChange={(event) => update('endedOn', event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('employments:form.jobTitle.label')}
        <input
          value={values.jobTitle}
          onChange={(event) => update('jobTitle', event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      {violations.length > 0 && (
        <ul className="flex flex-col gap-1">
          {violations.map((code) => (
            <li key={code} role="alert" className="text-sm text-red-700">
              {translateErrorCode(tError, code)}
            </li>
          ))}
        </ul>
      )}

      <ErrorMessage error={mutation.error} />

      <button
        type="submit"
        disabled={!canSubmit || mutation.isPending}
        className="self-start rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {t('employments:add')}
      </button>
    </form>
  )
}
