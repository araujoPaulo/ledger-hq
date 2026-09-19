import { Injectable } from '@nestjs/common'
import { uuidv7 } from 'uuidv7'
import { Prisma } from '../generated/prisma/client.js'
import {
  AppError,
  FISCAL_CATALOG,
  appliesTo,
  generatePeriods,
  resolveDueDate,
} from '@ledger-hq/domain'
import type {
  CatalogEntry,
  ClientKind,
  CreateAdHocObligationInput,
  ObligationStatus,
  ObligationSubject,
  PatchObligationInput,
} from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ClientsService } from '../clients/clients.service.js'
import type { Client, FiscalProfile, ObligationDefinition, ObligationInstance } from '../generated/prisma/client.js'

const HORIZON_MONTHS = 12

export type GenerateResult = {
  toCreate: Array<{ clientId: string; definitionCode: string; periodLabel: string; dueDate: string }>
  toRetract: Array<{ clientId: string; definitionCode: string; periodLabel: string }>
}

export type ObligationWithDefinition = ObligationInstance & { definition: ObligationDefinition; client: Client }

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
          // periodKeys only spans [floor, horizonEnd] — an old PENDING
          // instance whose period already ended (genuine arrears, rule
          // unchanged) falls outside that window and would otherwise look
          // indistinguishable from "the rule stopped applying." Retraction
          // must stay forward-only (master spec §7.3, invariant 4): only an
          // instance whose period hasn't ended yet can be retracted.
          if (
            instance.status === 'PENDING' &&
            instance.periodEnd >= input.asOf &&
            !periodKeys.has(isoKey(instance.periodStart))
          ) {
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
      // One transaction for the whole apply: the cron and a user's "Apply"
      // click can race on the same client, and without this, both would
      // read the same "missing" periods and then both attempt to create
      // them — the loser hitting the unique constraint mid-loop with the
      // winner's rows already committed, a half-generated state. skipDuplicates
      // makes the create side itself idempotent under that race too, not
      // just reliant on the constraint to reject the whole request.
      await this.prisma.$transaction(async (tx) => {
        if (toCreate.length > 0) {
          await tx.obligationInstance.createMany({
            data: toCreate.map((item) => ({
              id: uuidv7(),
              clientId: item.clientId,
              definitionCode: item.definitionCode,
              periodStart: item.period.start,
              periodEnd: item.period.end,
              periodLabel: item.period.label,
              dueDate: item.dueDate,
            })),
            skipDuplicates: true,
          })
        }

        if (toRetract.length > 0) {
          await tx.obligationInstance.deleteMany({ where: { id: { in: toRetract.map((item) => item.id) } } })
        }
      })
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

  async list(filters: { clientId?: string; status?: ObligationStatus[] }): Promise<ObligationWithDefinition[]> {
    return this.prisma.obligationInstance.findMany({
      where: {
        ...(filters.clientId ? { clientId: filters.clientId } : {}),
        status: { in: filters.status ?? ['PENDING', 'IN_PROGRESS'] },
      },
      include: { definition: true, client: true },
      orderBy: { dueDate: 'asc' },
    })
  }

  async findOne(id: string): Promise<ObligationWithDefinition> {
    const instance = await this.prisma.obligationInstance.findUnique({
      where: { id },
      include: { definition: true, client: true },
    })
    if (!instance) throw new AppError('common.not_found', {}, 404)
    return instance
  }

  async patch(id: string, input: PatchObligationInput): Promise<ObligationWithDefinition> {
    await this.findOne(id)

    await this.prisma.obligationInstance.update({
      where: { id },
      data: {
        ...(input.dueDate !== undefined ? { dueDate: new Date(`${input.dueDate}T00:00:00Z`), dueDateOverridden: true } : {}),
        ...(input.status !== undefined
          ? { status: input.status, completedAt: input.status === 'DONE' ? new Date() : null }
          : {}),
        ...(input.reference !== undefined ? { reference: input.reference } : {}),
        ...(input.amountCents !== undefined ? { amountCents: input.amountCents } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    })

    return this.findOne(id)
  }

  async createAdHoc(input: CreateAdHocObligationInput): Promise<ObligationWithDefinition> {
    await this.clients.findOne(input.clientId)

    const existingDefinition = await this.prisma.obligationDefinition.findUnique({ where: { code: input.code } })
    if (existingDefinition && existingDefinition.source === 'CATALOG') {
      throw new AppError('obligations.definition_code_taken', { code: input.code }, 409)
    }

    await this.prisma.obligationDefinition.upsert({
      where: { code: input.code },
      create: { code: input.code, name: input.name, authority: 'OTHER', periodicity: input.periodicity, source: 'CUSTOM', active: true },
      update: {},
    })

    return this.prisma.obligationInstance
      .create({
        data: {
          id: uuidv7(),
          clientId: input.clientId,
          definitionCode: input.code,
          periodStart: new Date(`${input.periodStart}T00:00:00Z`),
          periodEnd: new Date(`${input.periodEnd}T00:00:00Z`),
          periodLabel: input.periodLabel,
          dueDate: new Date(`${input.dueDate}T00:00:00Z`),
        },
        include: { definition: true, client: true },
      })
      .catch((error: unknown) => {
        throw toAdHocConflictOr(error)
      })
  }
}

/**
 * `ObligationInstance` carries exactly one relevant unique constraint here
 * (`[clientId, definitionCode, periodStart]`) — like `platforms.service.ts`'s
 * `toNameConflictOr`, no target-column check is needed to know which
 * constraint fired, and such a check would be unreliable regardless: the
 * driver adapter in use does not populate `error.meta.target` for a
 * unique-constraint violation.
 */
function toAdHocConflictOr(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new AppError('obligations.ad_hoc_already_exists', {}, 409)
  }
  return error
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
