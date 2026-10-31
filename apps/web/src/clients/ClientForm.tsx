import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import {
  ACCOUNTING_VALUES,
  CLIENT_KIND_VALUES,
  LEGAL_FORM_VALUES,
  createClientSchema,
  updateClientSchema,
} from '@ledger-hq/domain'
import type { Accounting, ClientKind, CreateClientInput, LegalForm, UpdateClientInput } from '@ledger-hq/domain'
import { ErrorMessage, translateErrorCode } from '../shell/ErrorMessage'
import { Button, Card, Input, PageHeader, Select, Textarea } from '../ui'
import type { ClientResponse } from './api'

export type ClientFormProps =
  | { mode: 'create'; onSubmit: (input: CreateClientInput) => void; isPending: boolean; error: unknown }
  | {
      mode: 'edit'
      initial: ClientResponse
      onSubmit: (input: UpdateClientInput) => void
      isPending: boolean
      error: unknown
    }

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

/** A loaded client as form state: an absent optional value is an empty string. */
function toFormState(client: ClientResponse): FormState {
  return {
    kind: client.kind,
    name: client.name,
    taxId: client.taxId,
    accounting: client.accounting,
    // Null only for an individual, whose form never shows or sends it.
    legalForm: (client.legalForm ?? 'LDA') as LegalForm,
    socialSecurityNo: client.socialSecurityNo ?? '',
    dateOfBirth: client.dateOfBirth ?? '',
    email: client.email ?? '',
    phone: client.phone ?? '',
    notes: client.notes ?? '',
  }
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

/** The optional fields — the only ones a user can try to empty. */
const CLEARABLE_FIELDS = ['email', 'phone', 'notes', 'socialSecurityNo', 'dateOfBirth'] as const

/**
 * `PATCH /clients/:id` cannot clear an optional field: an empty string fails
 * validation and an absent key means "unchanged". A field that had a value
 * and is now empty would appear to save while keeping the old value, so the
 * form refuses it instead (spec §6.2). Clearing needs the contract to accept
 * `null`, which is out of scope.
 */
function clearedFields(form: FormState, baseline: ClientResponse): string[] {
  return CLEARABLE_FIELDS.filter((field) => baseline[field] !== null && form[field].trim() === '')
}

/**
 * The validated candidate minus every field equal to its loaded value, plus
 * `kind` (the server requires it, and refuses a change). Parsed through the
 * update schema so the result is typed without a cast — it cannot fail: every
 * value already passed the create schema, which is stricter.
 */
function toUpdate(parsed: CreateClientInput, baseline: ClientResponse): UpdateClientInput {
  const changes: Record<string, unknown> = { kind: parsed.kind }

  for (const [field, value] of Object.entries(parsed)) {
    if (field === 'kind') continue
    if (value !== (baseline[field as keyof ClientResponse] ?? undefined)) changes[field] = value
  }

  return updateClientSchema.parse(changes)
}

/** The client form, for both creating and editing. The page owns the mutation and the navigation. */
export function ClientForm(props: ClientFormProps) {
  const { t } = useTranslation(['clients', 'common', 'domain'])
  const { t: tError } = useTranslation('errors')

  // The client as it was when the form opened. A background refetch while the
  // form is open (refocus, another tab) must not change what counts as
  // "changed", or a stale field the user never touched would be sent back
  // over a fresh one.
  const [baseline] = useState<ClientResponse | null>(() => (props.mode === 'edit' ? props.initial : null))
  const [form, setForm] = useState<FormState>(() =>
    props.mode === 'edit' ? toFormState(props.initial) : initialState,
  )
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const result = createClientSchema.safeParse(toCandidate(form))
    const messages = new Map<string, string>()

    if (!result.success) {
      for (const field of new Set(result.error.issues.map((issue) => String(issue.path[0])))) {
        const message = translateFieldError(field)
        if (message !== undefined) messages.set(field, message)
      }
    }
    if (baseline !== null) {
      for (const field of clearedFields(form, baseline)) messages.set(field, t('clients:form.cannotClear'))
    }

    if (!result.success || messages.size > 0) {
      setShowValidationError(true)
      setFieldErrors(messages)
      return
    }

    setShowValidationError(false)
    setFieldErrors(new Map())

    if (props.mode === 'create') props.onSubmit(result.data)
    else props.onSubmit(toUpdate(result.data, baseline ?? props.initial))
  }

  const isEdit = props.mode === 'edit'
  const backLinkClass = 'inline-flex items-center gap-1.5 self-start text-sm font-medium text-muted hover:text-ink'

  return (
    // noValidate: the field errors below are the form's one validation voice.
    // The browser's own bubble (type="email") would pre-empt them and bypass
    // the Field contract.
    <form noValidate className="flex max-w-3xl flex-col gap-6" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-4">
        {props.mode === 'edit' ? (
          <Link to="/clients/$clientId" params={{ clientId: props.initial.id }} className={backLinkClass}>
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            {props.initial.name}
          </Link>
        ) : (
          <Link to="/clients" className={backLinkClass}>
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            {t('clients:title')}
          </Link>
        )}
        <PageHeader title={isEdit ? t('clients:editTitle') : t('clients:newTitle')} />
      </div>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t('clients:form.section.identification')}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label={t('clients:form.name.label')}
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            error={fieldErrors.get('name')}
          />
          <Input
            label={t('clients:form.taxId.label')}
            inputMode="numeric"
            value={form.taxId}
            onChange={(event) => update('taxId', event.target.value)}
            error={fieldErrors.get('taxId')}
          />
          {/* Disabled on edit because it genuinely cannot change: PATCH refuses
              a kind change with clients.kind_mismatch. */}
          <Select
            label={t('clients:form.kind.label')}
            value={form.kind}
            disabled={isEdit}
            hint={isEdit ? t('clients:form.kind.immutable') : undefined}
            onChange={(event) => handleKindChange(event.target.value as ClientKind)}
          >
            {CLIENT_KIND_VALUES.map((kind) => (
              <option key={kind} value={kind}>
                {t(`domain:clientKind.${kind}`)}
              </option>
            ))}
          </Select>

          {/* Kind-specific fields are absent, not disabled, for the other
              kind: disabled reads as "you may not edit this", not "this does
              not apply" (spec §3). */}
          {form.kind === 'COMPANY' && (
            <Select
              label={t('clients:form.legalForm.label')}
              value={form.legalForm}
              onChange={(event) => update('legalForm', event.target.value as LegalForm)}
              error={fieldErrors.get('legalForm')}
            >
              {LEGAL_FORM_VALUES.map((value) => (
                <option key={value} value={value}>
                  {t(`domain:legalForm.${value}`)}
                </option>
              ))}
            </Select>
          )}

          {form.kind === 'INDIVIDUAL' && (
            <>
              <Input
                label={t('clients:form.socialSecurityNo.label')}
                inputMode="numeric"
                value={form.socialSecurityNo}
                onChange={(event) => update('socialSecurityNo', event.target.value)}
                error={fieldErrors.get('socialSecurityNo')}
              />
              <Input
                type="date"
                label={t('clients:form.dateOfBirth.label')}
                value={form.dateOfBirth}
                onChange={(event) => update('dateOfBirth', event.target.value)}
                error={fieldErrors.get('dateOfBirth')}
              />
            </>
          )}

          <Select
            label={t('clients:form.accounting.label')}
            value={form.accounting}
            onChange={(event) => update('accounting', event.target.value as Accounting)}
            error={fieldErrors.get('accounting')}
          >
            {ACCOUNTING_VALUES.map((value) => (
              <option key={value} value={value}>
                {t(`domain:accounting.${value}`)}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t('clients:form.section.contact')}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            type="email"
            label={t('clients:form.email.label')}
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            error={fieldErrors.get('email')}
          />
          <Input
            label={t('clients:form.phone.label')}
            value={form.phone}
            onChange={(event) => update('phone', event.target.value)}
            error={fieldErrors.get('phone')}
          />
          <div className="md:col-span-2">
            <Textarea
              label={t('clients:form.notes.label')}
              value={form.notes}
              onChange={(event) => update('notes', event.target.value)}
              error={fieldErrors.get('notes')}
            />
          </div>
        </div>
      </Card>

      {showValidationError && (
        <p role="alert" className="text-sm text-danger-700">
          {translateErrorCode(tError, 'common.validation_failed')}
        </p>
      )}

      <ErrorMessage error={props.error} />

      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" type="submit" isLoading={props.isPending}>
          {isEdit ? t('common:actions.save') : t('common:actions.create')}
        </Button>
        <Button asChild variant="ghost">
          {props.mode === 'edit' ? (
            <Link to="/clients/$clientId" params={{ clientId: props.initial.id }}>
              {t('common:actions.cancel')}
            </Link>
          ) : (
            <Link to="/clients">{t('common:actions.cancel')}</Link>
          )}
        </Button>
        {!isEdit && <p className="ml-auto text-xs text-muted">{t('clients:form.profileLater')}</p>}
      </div>
    </form>
  )
}
