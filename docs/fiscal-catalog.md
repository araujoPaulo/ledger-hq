# Fiscal obligation catalog

**Generated from `packages/domain/src/obligations/catalog/`. Do not edit by hand — edit the catalog source and re-run `pnpm --filter @ledger-hq/domain generate:fiscal-catalog`.**

## Português

| Code | Name | Description | Authority | Periodicity | Deadline | Legal reference | Valid from | Valid to |
|---|---|---|---|---|---|---|---|---|
| `VAT_MONTHLY_RETURN` | Declaração periódica de IVA | Regime mensal | TAX | MONTHLY | day 20 of the 2-months-after month | CIVA art. 41.º | 2023-01-01 | — |
| `VAT_QUARTERLY_RETURN` | Declaração periódica de IVA | Regime trimestral | TAX | QUARTERLY | day 20 of the 2-months-after month | CIVA art. 41.º | 2023-01-01 | — |
| `VAT_PAYMENT_MONTHLY` | Pagamento de IVA | Regime mensal | TAX | MONTHLY | day 25 of the 2-months-after month | CIVA art. 27.º | 2023-01-01 | — |
| `VAT_PAYMENT_QUARTERLY` | Pagamento de IVA | Regime trimestral | TAX | QUARTERLY | day 25 of the 2-months-after month | CIVA art. 27.º | 2023-01-01 | — |
| `EFATURA_INVOICE_REPORTING` | Comunicação de faturas (e-Fatura) | Comunicação mensal à AT | TAX | MONTHLY | day 5 of the 1-months-after month | Decreto-Lei n.º 198/2012 | 2023-01-01 | — |
| `DMR_AT` | Declaração Mensal de Remunerações (AT) | Retenções na fonte sobre rendimentos do trabalho | TAX | MONTHLY | day 10 of the 1-months-after month | CIRS art. 119.º | 2023-01-01 | — |
| `WITHHOLDING_TAX_PAYMENT` | Pagamento de retenções na fonte | Entrega mensal ao Estado | TAX | MONTHLY | day 20 of the 1-months-after month | CIRS art. 98.º | 2023-01-01 | — |
| `MODEL_22_CIT_RETURN` | Modelo 22 | Declaração anual de IRC | TAX | ANNUAL | 31/5 (following year) | CIRC art. 120.º | 2023-01-01 | — |
| `IES_ANNUAL_FILING` | IES | Informação Empresarial Simplificada | TAX | ANNUAL | 15/7 (following year) | Decreto-Lei n.º 8/2007 | 2023-01-01 | — |
| `CIT_PAYMENT_ON_ACCOUNT_1` | Pagamento por conta de IRC (1.º) | Primeira prestação | TAX | ANNUAL | 31/7 | CIRC art. 104.º | 2023-01-01 | — |
| `CIT_PAYMENT_ON_ACCOUNT_2` | Pagamento por conta de IRC (2.º) | Segunda prestação | TAX | ANNUAL | 30/9 | CIRC art. 104.º | 2023-01-01 | — |
| `CIT_PAYMENT_ON_ACCOUNT_3` | Pagamento por conta de IRC (3.º) | Terceira prestação (pagamento especial) | TAX | ANNUAL | 15/12 | CIRC art. 104.º | 2023-01-01 | — |
| `MODEL_10_INCOME_WITHHOLDING` | Modelo 10 | Declaração anual de rendimentos e retenções | TAX | ANNUAL | 31/1 (following year) | CIRS art. 119.º | 2023-01-01 | — |
| `MODEL_30_NON_RESIDENT_PAYMENTS` | Modelo 30 | Rendimentos pagos ou devidos a não residentes | TAX | MONTHLY | last day of the 2-months-after month | CIRC art. 119.º | 2023-01-01 | — |
| `INVENTORY_REPORTING` | Comunicação de inventários | Inventário valorizado reportado à AT | TAX | ANNUAL | 31/1 (following year) | CIVA art. 29.º | 2023-01-01 | — |
| `SS_REMUNERATION_DECLARATION` | Declaração de Remunerações (Segurança Social) | Remunerações do mês anterior | SOCIAL_SECURITY | MONTHLY | day 10 of the 1-months-after month | Código Contributivo art. 41.º | 2023-01-01 | — |
| `SS_CONTRIBUTION_PAYMENT` | Pagamento de contribuições | Contribuições para a Segurança Social | SOCIAL_SECURITY | MONTHLY | day 20 of the 1-months-after month | Código Contributivo art. 43.º | 2023-01-01 | — |
| `MODEL_3_PIT_RETURN` | Modelo 3 | Declaração anual de IRS | TAX | ANNUAL | 30/6 (following year) | CIRS art. 60.º | 2023-01-01 | — |

## English

| Code | Name | Description | Authority | Periodicity | Deadline | Legal reference | Valid from | Valid to |
|---|---|---|---|---|---|---|---|---|
| `VAT_MONTHLY_RETURN` | Declaração periódica de IVA | Monthly VAT return | TAX | MONTHLY | day 20 of the 2-months-after month | CIVA art. 41.º | 2023-01-01 | — |
| `VAT_QUARTERLY_RETURN` | Declaração periódica de IVA | Quarterly VAT return | TAX | QUARTERLY | day 20 of the 2-months-after month | CIVA art. 41.º | 2023-01-01 | — |
| `VAT_PAYMENT_MONTHLY` | Pagamento de IVA | Monthly VAT payment | TAX | MONTHLY | day 25 of the 2-months-after month | CIVA art. 27.º | 2023-01-01 | — |
| `VAT_PAYMENT_QUARTERLY` | Pagamento de IVA | Quarterly VAT payment | TAX | QUARTERLY | day 25 of the 2-months-after month | CIVA art. 27.º | 2023-01-01 | — |
| `EFATURA_INVOICE_REPORTING` | Comunicação de faturas (e-Fatura) | Monthly invoice reporting to the tax authority | TAX | MONTHLY | day 5 of the 1-months-after month | Decreto-Lei n.º 198/2012 | 2023-01-01 | — |
| `DMR_AT` | Declaração Mensal de Remunerações (AT) | Monthly withholding declaration to the tax authority | TAX | MONTHLY | day 10 of the 1-months-after month | CIRS art. 119.º | 2023-01-01 | — |
| `WITHHOLDING_TAX_PAYMENT` | Pagamento de retenções na fonte | Monthly withholding tax payment | TAX | MONTHLY | day 20 of the 1-months-after month | CIRS art. 98.º | 2023-01-01 | — |
| `MODEL_22_CIT_RETURN` | Modelo 22 | Annual corporate income tax return | TAX | ANNUAL | 31/5 (following year) | CIRC art. 120.º | 2023-01-01 | — |
| `IES_ANNUAL_FILING` | IES | Simplified corporate information return | TAX | ANNUAL | 15/7 (following year) | Decreto-Lei n.º 8/2007 | 2023-01-01 | — |
| `CIT_PAYMENT_ON_ACCOUNT_1` | Pagamento por conta de IRC (1.º) | First CIT payment on account | TAX | ANNUAL | 31/7 | CIRC art. 104.º | 2023-01-01 | — |
| `CIT_PAYMENT_ON_ACCOUNT_2` | Pagamento por conta de IRC (2.º) | Second CIT payment on account | TAX | ANNUAL | 30/9 | CIRC art. 104.º | 2023-01-01 | — |
| `CIT_PAYMENT_ON_ACCOUNT_3` | Pagamento por conta de IRC (3.º) | Third CIT payment on account | TAX | ANNUAL | 15/12 | CIRC art. 104.º | 2023-01-01 | — |
| `MODEL_10_INCOME_WITHHOLDING` | Modelo 10 | Annual income and withholding return | TAX | ANNUAL | 31/1 (following year) | CIRS art. 119.º | 2023-01-01 | — |
| `MODEL_30_NON_RESIDENT_PAYMENTS` | Modelo 30 | Payments made to non-residents | TAX | MONTHLY | last day of the 2-months-after month | CIRC art. 119.º | 2023-01-01 | — |
| `INVENTORY_REPORTING` | Comunicação de inventários | Year-end inventory reporting | TAX | ANNUAL | 31/1 (following year) | CIVA art. 29.º | 2023-01-01 | — |
| `SS_REMUNERATION_DECLARATION` | Declaração de Remunerações (Segurança Social) | Monthly wage declaration to Social Security | SOCIAL_SECURITY | MONTHLY | day 10 of the 1-months-after month | Código Contributivo art. 41.º | 2023-01-01 | — |
| `SS_CONTRIBUTION_PAYMENT` | Pagamento de contribuições | Social Security contribution payment | SOCIAL_SECURITY | MONTHLY | day 20 of the 1-months-after month | Código Contributivo art. 43.º | 2023-01-01 | — |
| `MODEL_3_PIT_RETURN` | Modelo 3 | Annual personal income tax return | TAX | ANNUAL | 30/6 (following year) | CIRS art. 60.º | 2023-01-01 | — |
