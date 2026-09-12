import type { Authority, ClientKind, IncomeTax, Periodicity, VatRegime } from '../enums'

export type Condition =
  | { field: 'kind'; op: 'eq'; value: ClientKind }
  | { field: 'vatRegime'; op: 'eq'; value: VatRegime }
  | { field: 'incomeTax'; op: 'eq'; value: IncomeTax }
  | {
      field: 'hasOpenActivity' | 'hasEmployees' | 'hasWithholding' | 'isVatCashBasis'
      op: 'eq'
      value: boolean
    }

export type ConditionGroup = { all: Condition[] }

export type DeadlineRule =
  | { kind: 'dayOfMonthAfterPeriodEnd'; day: number; monthsAfter: number }
  | { kind: 'fixedDate'; month: number; day: number; yearsAfter: number }
  | { kind: 'lastDayOfMonthAfterPeriodEnd'; monthsAfter: number }

/** The flattened subject `appliesWhen` conditions are evaluated against — the client's kind plus its fiscal profile, as one object (master spec 7.1). */
export type ObligationSubject = {
  kind: ClientKind
  hasOpenActivity: boolean
  vatRegime: VatRegime
  incomeTax: IncomeTax
  hasEmployees: boolean
  hasWithholding: boolean
  isVatCashBasis: boolean
}

export type CatalogEntry = {
  code: string
  authority: Authority
  periodicity: Periodicity
  legalRef: string
  appliesWhen: ConditionGroup
  deadline: DeadlineRule
  businessDayShift: 'NEXT'
  validFrom: string
  validTo: string | null
  i18n: { pt: { name: string; description: string }; en: { name: string; description: string } }
}

export type Period = { start: Date; end: Date; label: string }
