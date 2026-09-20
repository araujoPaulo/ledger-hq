import { Injectable } from '@nestjs/common'
import { uuidv7 } from 'uuidv7'
import { AppError, chargeDueDate, chargePeriodsSince, proposeAllocation } from '@ledger-hq/domain'
import type { ChargeBalance, CreateAdHocChargeInput, CreateRetainerPlanInput, ProposedAllocation, RecordPaymentInput, RenewRetainerPlanInput } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ClientsService } from '../clients/clients.service.js'
import type { Charge, RetainerPlan } from '../generated/prisma/client.js'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export type GenerateChargesResult = {
  toCreate: Array<{ clientId: string; planId: string; periodLabel: string; amountCents: number; dueOn: string }>
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
  ) {}

  /**
   * For each in-force `RetainerPlan`, creates one `Charge` per period that
   * has already started (master spec §8.1) — unlike the obligation
   * generator, no future horizon, and no retraction: a closed plan simply
   * stops producing new periods once `asOf` moves past its `validTo`.
   */
  async generateCharges(input: { asOf: Date; clientId?: string }, dryRun: boolean): Promise<GenerateChargesResult> {
    const clients = input.clientId
      ? [await this.clients.findOne(input.clientId)]
      : await this.prisma.client.findMany({ where: { archivedAt: null } })

    const toCreate: Array<{ clientId: string; planId: string; period: { start: Date; label: string }; amountCents: number; dueOn: Date }> = []

    for (const client of clients) {
      const plans = await this.prisma.retainerPlan.findMany({
        where: { clientId: client.id, validFrom: { lte: input.asOf }, OR: [{ validTo: null }, { validTo: { gte: input.asOf } }] },
      })

      for (const plan of plans) {
        const periods = chargePeriodsSince(plan.periodicity, plan.validFrom, input.asOf)
        const existing = await this.prisma.charge.findMany({ where: { clientId: client.id, planId: plan.id } })
        const existingLabels = new Set(existing.map((charge) => charge.periodLabel))

        for (const period of periods) {
          if (existingLabels.has(period.label)) continue
          toCreate.push({ clientId: client.id, planId: plan.id, period, amountCents: plan.amountCents, dueOn: chargeDueDate(period.start, plan.dueDayOfMonth) })
        }
      }
    }

    if (!dryRun) {
      for (const item of toCreate) {
        await this.prisma.charge.create({
          data: {
            id: uuidv7(),
            clientId: item.clientId,
            planId: item.planId,
            kind: 'RETAINER',
            description: `Retainer — ${item.period.label}`,
            periodLabel: item.period.label,
            amountCents: item.amountCents,
            issuedOn: item.period.start,
            dueOn: item.dueOn,
          },
        })
      }
    }

    return {
      toCreate: toCreate.map((item) => ({
        clientId: item.clientId,
        planId: item.planId,
        periodLabel: item.period.label,
        amountCents: item.amountCents,
        dueOn: isoDate(item.dueOn),
      })),
    }
  }

  /** Only for a client with no plan at all — see `renewRetainerPlan` for a fee change. */
  async createRetainerPlan(clientId: string, input: CreateRetainerPlanInput): Promise<RetainerPlan> {
    const existing = await this.prisma.retainerPlan.findFirst({ where: { clientId, validTo: null } })
    if (existing) throw new AppError('billing.plan_overlap', {}, 409)

    return this.prisma.retainerPlan.create({
      data: {
        id: uuidv7(),
        clientId,
        amountCents: input.amountCents,
        periodicity: input.periodicity,
        dueDayOfMonth: input.dueDayOfMonth,
        validFrom: new Date(`${input.validFrom}T00:00:00Z`),
        validTo: null,
      },
    })
  }

  /**
   * Closes the currently in-force plan (`validTo = effectiveFrom - 1 day`)
   * and creates its successor, in one transaction — a fee increase must
   * never leave a gap with no plan in force, nor overlap the closed one
   * (master spec §6.6). `periodicity`/`dueDayOfMonth` default to the
   * closed plan's own values when omitted, so a pure fee change never has
   * to resend fields it isn't changing.
   */
  async renewRetainerPlan(clientId: string, input: RenewRetainerPlanInput): Promise<{ closedPlanId: string | null; newPlanId: string }> {
    const effectiveFrom = new Date(`${input.effectiveFrom}T00:00:00Z`)

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.retainerPlan.findFirst({ where: { clientId, validTo: null } })

      if (current) {
        const validTo = new Date(effectiveFrom.getTime() - ONE_DAY_MS)
        if (validTo < current.validFrom) throw new AppError('billing.plan_overlap', {}, 409)
        await tx.retainerPlan.update({ where: { id: current.id }, data: { validTo } })
      }

      const created = await tx.retainerPlan.create({
        data: {
          id: uuidv7(),
          clientId,
          amountCents: input.newAmountCents,
          periodicity: input.periodicity ?? current?.periodicity ?? 'MONTHLY',
          dueDayOfMonth: input.dueDayOfMonth ?? current?.dueDayOfMonth ?? 8,
          validFrom: effectiveFrom,
          validTo: null,
        },
      })

      return { closedPlanId: current?.id ?? null, newPlanId: created.id }
    })
  }

  async proposeAllocationForClient(clientId: string, amountCents: number): Promise<{ proposed: ProposedAllocation[]; excessCents: number }> {
    const openCharges = await this.prisma.$queryRaw<ChargeBalance[]>`
      SELECT * FROM charge_balances WHERE "clientId" = ${clientId}::uuid AND "outstandingCents" > 0 ORDER BY "dueOn" ASC
    `
    const proposed = proposeAllocation(amountCents, openCharges)
    const allocatedCents = proposed.reduce((sum, allocation) => sum + allocation.amountCents, 0)
    return { proposed, excessCents: amountCents - allocatedCents }
  }

  /**
   * Persists the payment and every requested allocation atomically. Never
   * trusts the caller's arithmetic: re-validates against the payment's own
   * amount and each charge's *current* outstanding balance from
   * `charge_balances`, inside the same transaction, so a stale client-side
   * preview can never write an allocation the database wouldn't itself
   * justify.
   */
  async recordPayment(input: RecordPaymentInput): Promise<{ paymentId: string }> {
    const sumAllocated = input.allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0)
    if (sumAllocated > input.amountCents) throw new AppError('billing.allocation_exceeds_payment', {}, 422)

    return this.prisma.$transaction(async (tx) => {
      const paymentId = uuidv7()
      await tx.payment.create({
        data: {
          id: paymentId,
          clientId: input.clientId,
          amountCents: input.amountCents,
          receivedOn: new Date(`${input.receivedOn}T00:00:00Z`),
          method: input.method,
          reference: input.reference ?? null,
        },
      })

      for (const allocation of input.allocations) {
        const [balance] = await tx.$queryRaw<Array<{ outstandingCents: number }>>`
          SELECT "outstandingCents" FROM charge_balances WHERE id = ${allocation.chargeId}::uuid
        `
        if (!balance || allocation.amountCents > balance.outstandingCents) {
          throw new AppError('billing.allocation_exceeds_charge_balance', { chargeId: allocation.chargeId }, 422)
        }
        await tx.paymentAllocation.create({ data: { paymentId, chargeId: allocation.chargeId, amountCents: allocation.amountCents } })
      }

      return { paymentId }
    })
  }

  async createAdHocCharge(input: CreateAdHocChargeInput): Promise<Charge> {
    return this.prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId: input.clientId,
        kind: 'EXTRA',
        description: input.description,
        periodLabel: null,
        amountCents: input.amountCents,
        issuedOn: new Date(),
        dueOn: new Date(`${input.dueOn}T00:00:00Z`),
        planId: null,
      },
    })
  }

  async writeOffCharge(id: string, reason: string): Promise<Charge> {
    const charge = await this.prisma.charge.findUnique({ where: { id } })
    if (!charge) throw new AppError('common.not_found', {}, 404)

    return this.prisma.charge.update({ where: { id }, data: { writtenOffAt: new Date(), writeOffReason: reason } })
  }

  async getReceivables(asOf: Date): Promise<Array<{ clientId: string; clientName: string; outstandingCents: number; oldestDueOn: string; ageingBucket: '0-30' | '31-60' | '61-90' | '90+' }>> {
    const rows = await this.prisma.$queryRaw<Array<{ clientId: string; clientName: string; outstandingCents: number; oldestDueOn: Date }>>`
      SELECT
        c.id AS "clientId",
        c.name AS "clientName",
        SUM(b."outstandingCents")::int AS "outstandingCents",
        MIN(b."dueOn") AS "oldestDueOn"
      FROM charge_balances b
      JOIN "Client" c ON c.id = b."clientId"
      WHERE b."outstandingCents" > 0 AND b.status != 'WRITTEN_OFF'
      GROUP BY c.id, c.name
      ORDER BY "oldestDueOn" ASC
    `

    return rows.map((row) => {
      const daysOverdue = Math.floor((asOf.getTime() - row.oldestDueOn.getTime()) / (24 * 60 * 60 * 1000))
      const ageingBucket = daysOverdue > 90 ? '90+' : daysOverdue > 60 ? '61-90' : daysOverdue > 30 ? '31-60' : '0-30'
      return { clientId: row.clientId, clientName: row.clientName, outstandingCents: row.outstandingCents, oldestDueOn: isoDate(row.oldestDueOn), ageingBucket }
    })
  }

  async getCurrentMonth(asOf: Date): Promise<Array<{ clientId: string; clientName: string; paid: boolean; outstandingCents: number }>> {
    const periodLabel = `${asOf.getUTCFullYear()}-${String(asOf.getUTCMonth() + 1).padStart(2, '0')}`

    const rows = await this.prisma.$queryRaw<Array<{ clientId: string; clientName: string; outstandingCents: number | null }>>`
      SELECT
        c.id AS "clientId",
        c.name AS "clientName",
        COALESCE(SUM(b."outstandingCents") FILTER (WHERE b."periodLabel" = ${periodLabel}), 0)::int AS "outstandingCents"
      FROM "RetainerPlan" p
      JOIN "Client" c ON c.id = p."clientId"
      LEFT JOIN charge_balances b ON b."clientId" = p."clientId" AND b."periodLabel" = ${periodLabel} AND b.kind = 'RETAINER'
      WHERE p."validFrom" <= ${asOf} AND (p."validTo" IS NULL OR p."validTo" >= ${asOf})
      GROUP BY c.id, c.name
    `

    return rows.map((row) => ({ clientId: row.clientId, clientName: row.clientName, paid: (row.outstandingCents ?? 0) === 0, outstandingCents: row.outstandingCents ?? 0 }))
  }

  async getClientLedger(clientId: string): Promise<{ entries: Array<{ type: 'CHARGE' | 'PAYMENT'; date: string; description: string; amountCents: number; runningBalanceCents: number; chargeId: string | null }>; balanceCents: number }> {
    const charges = await this.prisma.charge.findMany({ where: { clientId }, orderBy: { issuedOn: 'asc' } })
    const payments = await this.prisma.payment.findMany({ where: { clientId }, orderBy: { receivedOn: 'asc' } })

    const events = [
      ...charges.map((charge) => ({ type: 'CHARGE' as const, date: charge.issuedOn, description: charge.description, amountCents: charge.amountCents, chargeId: charge.id })),
      ...payments.map((payment) => ({ type: 'PAYMENT' as const, date: payment.receivedOn, description: `Pagamento — ${payment.method}`, amountCents: -payment.amountCents, chargeId: null })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime())

    let runningBalanceCents = 0
    const entries = events.map((event) => {
      runningBalanceCents += event.amountCents
      return { type: event.type, date: isoDate(event.date), description: event.description, amountCents: event.amountCents, runningBalanceCents, chargeId: event.chargeId }
    })

    return { entries, balanceCents: runningBalanceCents }
  }
}
