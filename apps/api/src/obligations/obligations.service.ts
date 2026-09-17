import { Injectable } from '@nestjs/common'
import { uuidv7 } from 'uuidv7'
import {
  FISCAL_CATALOG,
  appliesTo,
  generatePeriods,
  resolveDueDate,
} from '@ledger-hq/domain'
import type { CatalogEntry, ClientKind, ObligationSubject } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ClientsService } from '../clients/clients.service.js'
import type { FiscalProfile } from '../generated/prisma/client.js'

const HORIZON_MONTHS = 12

export type GenerateResult = {
  toCreate: Array<{ clientId: string; definitionCode: string; periodLabel: string; dueDate: string }>
  toRetract: Array<{ clientId: string; definitionCode: string; periodLabel: string }>
}

@Injectable()
export class ObligationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
  ) {}

  /** Upserts one `ObligationDefinition` row per catalog entry — the table is a mirror of the catalog, never edited by hand for CATALOG-sourced codes. */
  async syncCatalogDefinitions(): Promise<void> {
    for (const entry of FISCAL_CATALOG) {
      await this.prisma.obligationDefinition.upsert({
        where: { code: entry.code },
        create: {
          code: entry.code,
          name: entry.i18n.pt.name,
          authority: entry.authority,
          periodicity: entry.periodicity,
          source: 'CATALOG',
          legalRef: entry.legalRef,
          active: true,
        },
        update: {
          name: entry.i18n.pt.name,
          authority: entry.authority,
          periodicity: entry.periodicity,
          legalRef: entry.legalRef,
          active: true,
        },
      })
    }
  }

  /**
   * The generator. `dryRun: true` computes and returns what would change
   * without writing anything; `dryRun: false` applies it. `input.clientId`
   * scopes the sweep to one client (used by the per-client preview after a
   * fiscal-profile save); omitted, it sweeps every active client (the daily
   * cron).
   */
  async generate(input: { asOf: Date; clientId?: string }, dryRun: boolean): Promise<GenerateResult> {
    await this.syncCatalogDefinitions()

    const clients = input.clientId
      ? [await this.clients.findOne(input.clientId)]
      : await this.prisma.client.findMany({ where: { archivedAt: null } })

    const horizonEnd = addMonths(input.asOf, HORIZON_MONTHS)
    const floor = addMonths(input.asOf, -3)

    const toCreate: Array<{ clientId: string; definitionCode: string; period: { start: Date; end: Date; label: string }; dueDate: Date }> = []
    const toRetract: Array<{ id: string; clientId: string; definitionCode: string; periodLabel: string }> = []

    for (const client of clients) {
      const profile = await this.prisma.fiscalProfile.findUnique({ where: { clientId: client.id } })
      if (!profile) continue

      const subject = toSubject(client.kind, profile)
      const existingInstances = await this.prisma.obligationInstance.findMany({ where: { clientId: client.id } })

      for (const entry of FISCAL_CATALOG) {
        const applies = appliesTo(entry, subject) && withinValidity(entry, input.asOf)
        const periods = applies ? generatePeriods(entry.periodicity, floor, horizonEnd) : []
        const periodKeys = new Set(periods.map((period) => isoKey(period.start)))

        const existingForCode = existingInstances.filter((instance) => instance.definitionCode === entry.code)
        const existingKeys = new Set(existingForCode.map((instance) => isoKey(instance.periodStart)))

        for (const period of periods) {
          if (!existingKeys.has(isoKey(period.start))) {
            toCreate.push({ clientId: client.id, definitionCode: entry.code, period, dueDate: resolveDueDate(entry, period) })
          }
        }

        for (const instance of existingForCode) {
          if (instance.status === 'PENDING' && !periodKeys.has(isoKey(instance.periodStart))) {
            toRetract.push({
              id: instance.id,
              clientId: client.id,
              definitionCode: entry.code,
              periodLabel: instance.periodLabel,
            })
          }
        }
      }
    }

    if (!dryRun) {
      for (const item of toCreate) {
        await this.prisma.obligationInstance.create({
          data: {
            id: uuidv7(),
            clientId: item.clientId,
            definitionCode: item.definitionCode,
            periodStart: item.period.start,
            periodEnd: item.period.end,
            periodLabel: item.period.label,
            dueDate: item.dueDate,
          },
        })
      }

      if (toRetract.length > 0) {
        await this.prisma.obligationInstance.deleteMany({ where: { id: { in: toRetract.map((item) => item.id) } } })
      }
    }

    return {
      toCreate: toCreate.map((item) => ({
        clientId: item.clientId,
        definitionCode: item.definitionCode,
        periodLabel: item.period.label,
        dueDate: isoKey(item.dueDate),
      })),
      toRetract: toRetract.map((item) => ({
        clientId: item.clientId,
        definitionCode: item.definitionCode,
        periodLabel: item.periodLabel,
      })),
    }
  }
}

function toSubject(kind: ClientKind, profile: FiscalProfile): ObligationSubject {
  return {
    kind,
    hasOpenActivity: profile.hasOpenActivity,
    vatRegime: profile.vatRegime,
    incomeTax: profile.incomeTax,
    hasEmployees: profile.hasEmployees,
    hasWithholding: profile.hasWithholding,
    isVatCashBasis: profile.isVatCashBasis,
  }
}

function isoKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()))
}

function withinValidity(entry: CatalogEntry, asOf: Date): boolean {
  const validFrom = new Date(`${entry.validFrom}T00:00:00Z`)
  if (asOf < validFrom) return false
  if (entry.validTo === null) return true
  return asOf <= new Date(`${entry.validTo}T00:00:00Z`)
}
