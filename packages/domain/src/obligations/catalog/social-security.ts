import type { CatalogEntry } from '../catalog-types'

const VALID_FROM = '2023-01-01'

export const SOCIAL_SECURITY_CATALOG: CatalogEntry[] = [
  {
    code: 'SS_REMUNERATION_DECLARATION',
    authority: 'SOCIAL_SECURITY',
    periodicity: 'MONTHLY',
    legalRef: 'Código Contributivo art. 41.º',
    appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'COMPANY' }] },
    deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 10, monthsAfter: 1 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Declaração de Remunerações (Segurança Social)', description: 'Remunerações do mês anterior' },
      en: { name: 'Declaração de Remunerações (Segurança Social)', description: 'Monthly wage declaration to Social Security' },
    },
  },
  {
    code: 'SS_CONTRIBUTION_PAYMENT',
    authority: 'SOCIAL_SECURITY',
    periodicity: 'MONTHLY',
    legalRef: 'Código Contributivo art. 43.º',
    appliesWhen: { all: [{ field: 'kind', op: 'eq', value: 'COMPANY' }] },
    deadline: { kind: 'dayOfMonthAfterPeriodEnd', day: 20, monthsAfter: 1 },
    businessDayShift: 'NEXT',
    validFrom: VALID_FROM,
    validTo: null,
    i18n: {
      pt: { name: 'Pagamento de contribuições', description: 'Contribuições para a Segurança Social' },
      en: { name: 'Pagamento de contribuições', description: 'Social Security contribution payment' },
    },
  },
]
