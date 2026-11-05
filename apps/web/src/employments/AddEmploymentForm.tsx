import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ERROR_CODES, createEmploymentSchema } from '@ledger-hq/domain'
import type { ClientKind, ErrorCode } from '@ledger-hq/domain'
import { ErrorMessage, translateErrorCode } from '../shell/ErrorMessage'
import { listClients } from '../clients/api'
import { Button, Dialog, Input, Select } from '../ui'
import { createEmployment } from './api'

type Props = { client: { id: string; kind: ClientKind; name: string }; onAdded: () => void }

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

/** Renders inside `Dialog.Content`. A fresh form each time the dialog opens. */
export function AddEmploymentForm({ client, onAdded }: Props) {
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
      onAdded()
    },
  })

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  const canSubmit =
    values.counterpartyId !== '' && values.startedOn !== '' && violations.length === 0 && parsed.success
  const counterpartyLabel = isCompany ? t('employments:form.employee.label') : t('employments:form.employer.label')

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit) return
        mutation.mutate()
      }}
    >
      <Select
        label={counterpartyLabel}
        value={values.counterpartyId}
        onChange={(event) => update('counterpartyId', event.target.value)}
      >
        <option value="" disabled>
          {counterpartyLabel}
        </option>
        {counterparties.data?.map((counterparty) => (
          <option key={counterparty.id} value={counterparty.id}>
            {counterparty.name}
          </option>
        ))}
      </Select>
      {/*
       * Without this, a failed fetch of eligible counterparties would look
       * identical to "none exist yet" — an empty dropdown with no
       * explanation — the same shape of bug the fiscal profile form used to
       * have before it was fixed to distinguish "no profile yet" from a
       * genuine fetch failure.
       */}
      {counterparties.isError ? <ErrorMessage error={counterparties.error} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          type="date"
          label={t('employments:form.startedOn.label')}
          value={values.startedOn}
          onChange={(event) => update('startedOn', event.target.value)}
        />
        <Input
          type="date"
          label={t('employments:form.endedOn.label')}
          value={values.endedOn}
          onChange={(event) => update('endedOn', event.target.value)}
        />
      </div>
      <Input
        label={t('employments:form.jobTitle.label')}
        value={values.jobTitle}
        onChange={(event) => update('jobTitle', event.target.value)}
      />

      {violations.length > 0 && (
        <ul className="flex flex-col gap-1">
          {violations.map((code) => (
            <li key={code} role="alert" className="text-sm text-danger-700">
              {translateErrorCode(tError, code)}
            </li>
          ))}
        </ul>
      )}

      <ErrorMessage error={mutation.error} />

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="ghost">{t('common:actions.cancel')}</Button>
        </Dialog.Close>
        <Button variant="primary" type="submit" isLoading={mutation.isPending} disabled={!canSubmit}>
          {t('employments:add')}
        </Button>
      </Dialog.Footer>
    </form>
  )
}
