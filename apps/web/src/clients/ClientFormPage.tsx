import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ACCOUNTING_VALUES, CLIENT_KIND_VALUES, LEGAL_FORM_VALUES, createClientSchema } from '@ledger-hq/domain'
import type { Accounting, ClientKind, CreateClientInput, LegalForm } from '@ledger-hq/domain'
import { ErrorMessage, translateErrorCode } from '../shell/ErrorMessage'
import { createClient } from './api'

type FormState = {
  kind: ClientKind
  name: string
  taxId: string
  accounting: Accounting
  legalForm: LegalForm
  socialSecurityNo: string
  dateOfBirth: string
  email: string
  phone: string
  notes: string
}

const initialState: FormState = {
  kind: 'COMPANY',
  name: '',
  taxId: '',
  accounting: 'ORGANIZED',
  legalForm: 'LDA',
  socialSecurityNo: '',
  dateOfBirth: '',
  email: '',
  phone: '',
  notes: '',
}

/** The schema rejects an empty optional string rather than treating it as absent. */
function emptyToUndefined(value: string): string | undefined {
  return value.trim() === '' ? undefined : value
}

function toCandidate(form: FormState): unknown {
  const shared = {
    name: form.name,
    taxId: form.taxId,
    accounting: form.accounting,
    email: emptyToUndefined(form.email),
    phone: emptyToUndefined(form.phone),
    notes: emptyToUndefined(form.notes),
  }

  if (form.kind === 'COMPANY') {
    return { kind: 'COMPANY', legalForm: form.legalForm, ...shared }
  }

  return {
    kind: 'INDIVIDUAL',
    socialSecurityNo: emptyToUndefined(form.socialSecurityNo),
    dateOfBirth: emptyToUndefined(form.dateOfBirth),
    ...shared,
  }
}

export function ClientFormPage() {
  const { t } = useTranslation(['clients', 'common', 'domain'])
  const { t: tError } = useTranslation('errors')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [form, setForm] = useState<FormState>(initialState)
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set())
  const [showValidationError, setShowValidationError] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Map<string, string>>(new Map())

  /**
   * Per-field messages for the schema's own validation failures.
   *
   * `createClientSchema`'s refinements deliberately carry no `ErrorCode`
   * message (see the comment on `taxId` in
   * packages/domain/src/schemas/client.ts): that convention exists to avoid
   * colliding with the server-side pipe's code-promotion mechanism, so a
   * local `safeParse` failure here produces plain Zod issue codes
   * (`too_small`, `custom`, `invalid_format`, `invalid_value`, `too_big` —
   * confirmed empirically against this Zod version, not assumed), never a
   * domain `ErrorCode`. There is nothing in the `errors` namespace to look
   * those up against, so this switch calls `t()` on a literal key per
   * field — never on the field name itself — and stays entirely inside
   * `clients.json`'s `form.*.invalid` keys. It never touches
   * `packages/domain`, `ERROR_CODES`, or the `errors` namespace.
   */
  function translateFieldError(field: string): string | undefined {
    switch (field) {
      case 'name':
        return t('clients:form.name.invalid')
      case 'taxId':
        return t('clients:form.taxId.invalid')
      case 'accounting':
        return t('clients:form.accounting.invalid')
      case 'legalForm':
        return t('clients:form.legalForm.invalid')
      case 'socialSecurityNo':
        return t('clients:form.socialSecurityNo.invalid')
      case 'dateOfBirth':
        return t('clients:form.dateOfBirth.invalid')
      case 'email':
        return t('clients:form.email.invalid')
      case 'phone':
        return t('clients:form.phone.invalid')
      case 'notes':
        return t('clients:form.notes.invalid')
      default:
        return undefined
    }
  }

  function fieldError(field: string) {
    const message = fieldErrors.get(field)
    if (!message) return null

    return (
      <p role="alert" className="text-sm text-red-700">
        {message}
      </p>
    )
  }

  const mutation = useMutation({
    mutationFn: (input: CreateClientInput) => createClient(input),
    onSuccess: async (client) => {
      // Without this, the list page's cached (now-stale) result — fetched
      // before this client existed — is still within its 30s staleTime on
      // the next visit, so it renders "no clients yet" for up to half a
      // minute after creating one. Every other mutation that changes what
      // the list would show (archive, restore) already invalidates it.
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      await navigate({ to: '/clients/$clientId', params: { clientId: client.id } })
    },
  })

  function handleKindChange(next: ClientKind) {
    setForm((current) => ({
      ...current,
      kind: next,
      accounting: next === 'COMPANY' ? 'ORGANIZED' : 'SIMPLIFIED',
      legalForm: 'LDA',
      // Clearing rather than merely omitting: these fields must not survive
      // a switch away from the kind they belong to.
      socialSecurityNo: '',
      dateOfBirth: '',
    }))
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  return (
    <form
      className="mx-auto flex max-w-md flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()

        const result = createClientSchema.safeParse(toCandidate(form))
        if (!result.success) {
          const fields = new Set(result.error.issues.map((issue) => String(issue.path[0])))
          setInvalidFields(fields)
          setShowValidationError(true)

          const messages = new Map<string, string>()
          for (const field of fields) {
            const message = translateFieldError(field)
            if (message !== undefined) messages.set(field, message)
          }
          setFieldErrors(messages)
          return
        }

        setInvalidFields(new Set())
        setShowValidationError(false)
        setFieldErrors(new Map())
        mutation.mutate(result.data)
      }}
    >
      <h1 className="text-lg font-semibold">{t('clients:newTitle')}</h1>

      <label className="flex flex-col gap-1 text-sm">
        {t('clients:form.kind.label')}
        <select
          value={form.kind}
          onChange={(event) => handleKindChange(event.target.value as ClientKind)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          {CLIENT_KIND_VALUES.map((kind) => (
            <option key={kind} value={kind}>
              {t(`domain:clientKind.${kind}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('clients:form.name.label')}
        <input
          value={form.name}
          onChange={(event) => update('name', event.target.value)}
          aria-invalid={invalidFields.has('name')}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>
      {fieldError('name')}

      <label className="flex flex-col gap-1 text-sm">
        {t('clients:form.taxId.label')}
        <input
          value={form.taxId}
          onChange={(event) => update('taxId', event.target.value)}
          aria-invalid={invalidFields.has('taxId')}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>
      {fieldError('taxId')}

      <label className="flex flex-col gap-1 text-sm">
        {t('clients:form.accounting.label')}
        <select
          value={form.accounting}
          onChange={(event) => update('accounting', event.target.value as Accounting)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          {ACCOUNTING_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`domain:accounting.${value}`)}
            </option>
          ))}
        </select>
      </label>
      {fieldError('accounting')}

      {form.kind === 'COMPANY' && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            {t('clients:form.legalForm.label')}
            <select
              value={form.legalForm}
              onChange={(event) => update('legalForm', event.target.value as LegalForm)}
              className="rounded border border-slate-300 px-2 py-1"
            >
              {LEGAL_FORM_VALUES.map((value) => (
                <option key={value} value={value}>
                  {t(`domain:legalForm.${value}`)}
                </option>
              ))}
            </select>
          </label>
          {fieldError('legalForm')}
        </>
      )}

      {form.kind === 'INDIVIDUAL' && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            {t('clients:form.socialSecurityNo.label')}
            <input
              value={form.socialSecurityNo}
              onChange={(event) => update('socialSecurityNo', event.target.value)}
              aria-invalid={invalidFields.has('socialSecurityNo')}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </label>
          {fieldError('socialSecurityNo')}

          <label className="flex flex-col gap-1 text-sm">
            {t('clients:form.dateOfBirth.label')}
            <input
              type="date"
              value={form.dateOfBirth}
              onChange={(event) => update('dateOfBirth', event.target.value)}
              aria-invalid={invalidFields.has('dateOfBirth')}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </label>
          {fieldError('dateOfBirth')}
        </>
      )}

      <label className="flex flex-col gap-1 text-sm">
        {t('clients:form.email.label')}
        <input
          type="email"
          value={form.email}
          onChange={(event) => update('email', event.target.value)}
          aria-invalid={invalidFields.has('email')}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>
      {fieldError('email')}

      <label className="flex flex-col gap-1 text-sm">
        {t('clients:form.phone.label')}
        <input
          value={form.phone}
          onChange={(event) => update('phone', event.target.value)}
          aria-invalid={invalidFields.has('phone')}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>
      {fieldError('phone')}

      <label className="flex flex-col gap-1 text-sm">
        {t('clients:form.notes.label')}
        <textarea
          value={form.notes}
          onChange={(event) => update('notes', event.target.value)}
          aria-invalid={invalidFields.has('notes')}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>
      {fieldError('notes')}

      {showValidationError && (
        <p role="alert" className="text-sm text-red-700">
          {translateErrorCode(tError, 'common.validation_failed')}
        </p>
      )}

      <ErrorMessage error={mutation.error} />

      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {t('common:actions.save')}
      </button>
    </form>
  )
}
