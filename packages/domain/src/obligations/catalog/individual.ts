import type { CatalogEntry } from '../catalog-types'

export const INDIVIDUAL_CATALOG: CatalogEntry[] = [
  {
    code: 'MODEL_3_PIT_RETURN',
    authority: 'TAX',
    periodicity: 'ANNUAL',
    legalRef: 'CIRS art. 60.º',
    // The master spec's own filing window is "1 April to 30 June" — encoded
    // as its closing date, 30 June, the date lateness is measured against
    // (see this plan's "Decisions" section).
    appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'INDIVIDUAL' }] },
    deadline: { kind: 'fixedDate', month: 6, day: 30, yearsAfter: 1 },
    businessDayShift: 'NEXT',
    validFrom: '2023-01-01',
    validTo: null,
    i18n: {
      pt: { name: 'Modelo 3', description: 'Declaração anual de IRS' },
      en: { name: 'Modelo 3', description: 'Annual personal income tax return' },
    },
  },
]
