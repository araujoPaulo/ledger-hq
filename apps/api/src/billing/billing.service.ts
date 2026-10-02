import { Injectable } from '@nestjs/common'
import { uuidv7 } from 'uuidv7'
import { AppError, chargeDueDate, chargePeriodsSince, proposeAllocation, settleOnPaper } from '@ledger-hq/domain'
import type { AllocationSource, ApplyCreditInput, ChargeBalance, CreateAdHocChargeInput, CreateRetainerPlanInput, ProposedAllocation, RecordPaymentInput, RenewRetainerPlanInput } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ClientsService } from '../clients/clients.service.js'
import type { Charge, RetainerPlan } from '../generated/prisma/client.js'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** A proposal row: the allocation plus enough of the charge to recognise it. */
export type ProposedAllocationRow = ProposedAllocation & {
  description: string
  periodLabel: string | null
  dueOn: string | null
}

export type LedgerEntry = {
  type: 'CHARGE' | 'PAYMENT' | 'WRITE_OFF'
  date: string
  description: string
  amountCents: number
  runningBalanceCents: number
  chargeId: string | null
  /** True on a written-off charge and on its own write-off entry. */
  writtenOff: boolean
}

export type GenerateChargesResult = {
  toCreate: Array<{ clientId: string; planId: string; periodLabel: string; amountCents: number; dueOn: string }>
  /** What the credit on hand would settle, once `toCreate` exists. Empty when no client has credit. */
  creditToAllocate: ProposedAllocationRow[]
  created: number
  allocated: number
}

export type ApplyCreditResult = {
  proposed: ProposedAllocationRow[]
  remainingCreditCents: number
  allocated: number
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function toWireItem(item: { clientId: string; planId: string; period: { label: string }; amountCents: number; dueOn: Date }) {
  return { clientId: item.clientId, planId: item.planId, periodLabel: item.period.label, amountCents: item.amountCents, dueOn: isoDate(item.dueOn) }
}

/**
 * A confirmed allocation always names a real payment. `paymentId` is only
 * ever `null` for the payment being recorded in the same request, which this
 * path never has.
 */
function toConfirmedAllocation(allocation: ProposedAllocation): { paymentId: string; chargeId: string; amountCents: number } {
  if (allocation.paymentId === null) throw new AppError('billing.allocation_exceeds_available_credit', {}, 422)
  return { paymentId: allocation.paymentId, chargeId: allocation.chargeId, amountCents: allocation.amountCents }
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

      // Scoped to the client, NOT to the plan: a fee change mid-period creates
      // a successor plan whose own `validFrom` falls inside a period the
      // closed plan already charged, and the unique index is per-`planId`, so
      // a plan-scoped lookup would happily bill that period a second time
      // under the new plan's id and amount.
      const existing = await this.prisma.charge.findMany({ where: { clientId: client.id, kind: 'RETAINER' } })
      const existingLabels = new Set(existing.map((charge) => charge.periodLabel))

      for (const plan of plans) {
        const periods = chargePeriodsSince(plan.periodicity, plan.validFrom, input.asOf)

        for (const period of periods) {
          if (existingLabels.has(period.label)) continue
          existingLabels.add(period.label)
          toCreate.push({ clientId: client.id, planId: plan.id, period, amountCents: plan.amountCents, dueOn: chargeDueDate(period.start, plan.dueDayOfMonth) })
        }
      }
    }

    const clientIds = [...new Set(toCreate.map((item) => item.clientId))]
    let created = 0
    let allocated = 0
    const creditToAllocate: ProposedAllocationRow[] = []

    if (dryRun) {
      // The charges do not exist yet, so the proposal is built from what
      // `toCreate` describes rather than from `charge_balances`: a preview
      // that ignored them would always report nothing to spend.
      for (const clientId of clientIds) {
        const credit = await this.getAvailableCredit(clientId)
        if (credit.totalCents === 0) continue

        const pending = toCreate
          .filter((item) => item.clientId === clientId)
          .map((item) => ({
            id: `pending:${item.planId}:${item.period.label}`,
            clientId,
            kind: 'RETAINER' as const,
            periodLabel: item.period.label,
            dueOn: item.dueOn,
            amountCents: item.amountCents,
            allocatedCents: 0,
            outstandingCents: item.amountCents,
            status: 'OPEN' as const,
            description: `Retainer — ${item.period.label}`,
          }))

        const existing = await this.openChargesFor(clientId, input.asOf)
        const charges = [...existing, ...pending]
        creditToAllocate.push(...this.toProposalRows(proposeAllocation(credit.sources, charges), charges))
      }

      return { toCreate: toCreate.map(toWireItem), creditToAllocate, created: 0, allocated: 0 }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of toCreate) {
        await tx.charge.create({
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
        created += 1
      }
    })

    // Outside the creation transaction, and deliberately: a client whose
    // credit cannot be spent for any reason must still get its charges. The
    // charges are the statement of debt; spending credit against them is a
    // convenience that can be retried from the ledger.
    for (const clientId of clientIds) {
      const credit = await this.getAvailableCredit(clientId)
      if (credit.totalCents === 0) continue

      const charges = await this.openChargesFor(clientId, input.asOf)
      const proposed = proposeAllocation(credit.sources, charges)
      if (proposed.length === 0) continue

      const result = await this.applyCredit(clientId, { allocations: proposed.map(toConfirmedAllocation) }, false)
      allocated += result.allocated
      creditToAllocate.push(...this.toProposalRows(proposed, charges))
    }

    return { toCreate: toCreate.map(toWireItem), creditToAllocate, created, allocated }
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

  async getCurrentRetainerPlan(clientId: string): Promise<RetainerPlan | null> {
    return this.prisma.retainerPlan.findFirst({ where: { clientId, validTo: null } })
  }

  /**
   * A client's charges that are open, due, and not forgiven — the only
   * charges any proposal may touch. `charge_balances` carries no
   * `description` (it is derived state over amounts, not a copy of the
   * charge), so the charge is joined back in for the human-readable half.
   */
  private async openChargesFor(clientId: string, asOf: Date): Promise<Array<ChargeBalance & { description: string }>> {
    return this.prisma.$queryRaw<Array<ChargeBalance & { description: string }>>`
      SELECT b.*, c.description
      FROM charge_balances b
      JOIN "Charge" c ON c.id = b.id
      WHERE b."clientId" = ${clientId}::uuid
        AND b."outstandingCents" > 0
        AND b.status != 'WRITTEN_OFF'
        AND b."dueOn" <= ${asOf}
      ORDER BY b."dueOn" ASC
    `
  }

  /** Decorates a bare proposal with what identifies each charge to a human. */
  private toProposalRows(proposed: ProposedAllocation[], charges: Array<ChargeBalance & { description: string }>): ProposedAllocationRow[] {
    const byId = new Map(charges.map((charge) => [charge.id, charge]))
    return proposed.map((allocation) => {
      const charge = byId.get(allocation.chargeId)
      return {
        paymentId: allocation.paymentId,
        chargeId: allocation.chargeId,
        amountCents: allocation.amountCents,
        description: charge?.description ?? '',
        periodLabel: charge?.periodLabel ?? null,
        dueOn: charge ? isoDate(charge.dueOn) : null,
      }
    })
  }

  async proposeAllocationForClient(clientId: string, amountCents: number): Promise<{ proposed: ProposedAllocationRow[]; excessCents: number }> {
    const charges = await this.openChargesFor(clientId, new Date())
    // One source: the payment being recorded now, which has no id yet.
    const proposed = proposeAllocation([{ paymentId: null, availableCents: amountCents, receivedOn: new Date() }], charges)
    const allocatedCents = proposed.reduce((sum, allocation) => sum + allocation.amountCents, 0)
    return { proposed: this.toProposalRows(proposed, charges), excessCents: amountCents - allocatedCents }
  }

  /**
   * Money this client has already paid that no charge has claimed
   * (Phase 4a design §4.1). Ordered oldest first, which is the order
   * `proposeAllocation` spends them in.
   */
  async getAvailableCredit(clientId: string): Promise<{ sources: AllocationSource[]; totalCents: number }> {
    const rows = await this.prisma.$queryRaw<Array<{ paymentId: string; receivedOn: Date; creditCents: number }>>`
      SELECT "paymentId", "receivedOn", "creditCents"
      FROM payment_credits
      WHERE "clientId" = ${clientId}::uuid AND "creditCents" > 0
      ORDER BY "receivedOn" ASC, "paymentId" ASC
    `

    return {
      sources: rows.map((row) => ({ paymentId: row.paymentId, availableCents: row.creditCents, receivedOn: row.receivedOn })),
      totalCents: rows.reduce((sum, row) => sum + row.creditCents, 0),
    }
  }

  /**
   * Spends credit the client already paid against charges already due
   * (Phase 4a design §4.3). Same propose-then-confirm discipline as
   * `recordPayment`, without a new payment: a dry run proposes, a confirm
   * writes exactly the allocations it was handed, re-validated against the
   * database's own view of both halves.
   */
  async applyCredit(clientId: string, input: ApplyCreditInput | null, dryRun: boolean): Promise<ApplyCreditResult> {
    const asOf = new Date()
    const credit = await this.getAvailableCredit(clientId)

    if (dryRun) {
      const charges = await this.openChargesFor(clientId, asOf)
      const proposed = proposeAllocation(credit.sources, charges)
      const allocatedCents = proposed.reduce((sum, allocation) => sum + allocation.amountCents, 0)
      return { proposed: this.toProposalRows(proposed, charges), remainingCreditCents: credit.totalCents - allocatedCents, allocated: 0 }
    }

    const allocations = input?.allocations ?? []
    if (allocations.length === 0) return { proposed: [], remainingCreditCents: credit.totalCents, allocated: 0 }

    await this.prisma.$transaction(async (tx) => {
      for (const allocation of allocations) {
        // Two locks, payment first then charge. `recordPayment` locks only
        // the charge, and cannot deadlock against this: the payment it
        // allocates from is created inside its own transaction, so no other
        // writer can be holding that row. `FOR UPDATE` cannot be taken on
        // either view (Postgres rejects it on a grouped query), so both
        // locks go on the base tables.
        await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${allocation.paymentId}::uuid FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM "Charge" WHERE id = ${allocation.chargeId}::uuid FOR UPDATE`

        // Bound to this client on both sides: without it, a stale proposal
        // held across a client navigation could spend one client's credit on
        // another client's debt.
        const [credited] = await tx.$queryRaw<Array<{ creditCents: number }>>`
          SELECT "creditCents" FROM payment_credits
          WHERE "paymentId" = ${allocation.paymentId}::uuid AND "clientId" = ${clientId}::uuid
        `
        if (!credited || allocation.amountCents > credited.creditCents) {
          throw new AppError('billing.allocation_exceeds_available_credit', { paymentId: allocation.paymentId }, 422)
        }

        const [balance] = await tx.$queryRaw<Array<{ outstandingCents: number }>>`
          SELECT "outstandingCents" FROM charge_balances
          WHERE id = ${allocation.chargeId}::uuid
            AND "clientId" = ${clientId}::uuid
            AND status != 'WRITTEN_OFF'
        `
        if (!balance || allocation.amountCents > balance.outstandingCents) {
          throw new AppError('billing.allocation_exceeds_charge_balance', { chargeId: allocation.chargeId }, 422)
        }

        // Always a new row, never merged into an existing one for the same
        // (paymentId, chargeId): a top-up applied later must carry its own
        // createdAt, not overwrite the amount on a row already dated to an
        // earlier tranche. Over-allocation is still impossible — the
        // credit and balance checks above just read fresh, and both
        // aggregate over however many rows already exist for this pair.
        await tx.paymentAllocation.create({
          data: { id: uuidv7(), paymentId: allocation.paymentId, chargeId: allocation.chargeId, amountCents: allocation.amountCents },
        })
      }
    })

    const after = await this.getAvailableCredit(clientId)
    return { proposed: [], remainingCreditCents: after.totalCents, allocated: allocations.length }
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
        // Lock the charge row before reading its derived balance. The lock
        // cannot be taken on `charge_balances` itself (Postgres rejects
        // `FOR UPDATE` on a grouped query), so it goes on the underlying
        // `Charge`, which is enough to serialise two concurrent payments
        // against the same charge and stop them both passing the check
        // below on the same stale balance.
        await tx.$queryRaw`SELECT id FROM "Charge" WHERE id = ${allocation.chargeId}::uuid FOR UPDATE`

        // Scoped to the paying client, and never a written-off charge:
        // without the `clientId` bound, a stale proposal held across a
        // client navigation could settle another client's debt with this
        // client's money, and the write-off filter keeps FIFO from
        // steering payments onto debt the operator already declared dead.
        const [balance] = await tx.$queryRaw<Array<{ outstandingCents: number }>>`
          SELECT "outstandingCents" FROM charge_balances
          WHERE id = ${allocation.chargeId}::uuid
            AND "clientId" = ${input.clientId}::uuid
            AND status != 'WRITTEN_OFF'
        `
        if (!balance || allocation.amountCents > balance.outstandingCents) {
          throw new AppError('billing.allocation_exceeds_charge_balance', { chargeId: allocation.chargeId }, 422)
        }
        await tx.paymentAllocation.create({ data: { id: uuidv7(), paymentId, chargeId: allocation.chargeId, amountCents: allocation.amountCents } })
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
    // Re-stamping would move `writtenOffAt` and overwrite the original
    // reason, silently rewriting why a debt was forgiven.
    if (charge.writtenOffAt !== null) throw new AppError('billing.charge_already_written_off', {}, 409)

    return this.prisma.charge.update({ where: { id }, data: { writtenOffAt: new Date(), writeOffReason: reason } })
  }

  /**
   * Who owes what, netted against what they have already paid but not yet
   * spent (Phase 4a design §4.4). The netting is **notional**: no allocation
   * is written here. Both parts travel so the operator can see where the net
   * figure came from without opening the client.
   */
  async getReceivables(asOf: Date): Promise<
    Array<{
      clientId: string
      clientName: string
      grossOutstandingCents: number
      creditCents: number
      outstandingCents: number
      oldestDueOn: string
      ageingBucket: '0-30' | '31-60' | '61-90' | '90+'
    }>
  > {
    // Per charge, not per client: the ageing bucket has to know which
    // individual charges the credit reaches before it can say how old the
    // rest are.
    const charges = await this.prisma.$queryRaw<Array<{ clientId: string; clientName: string; dueOn: Date; outstandingCents: number }>>`
      SELECT c.id AS "clientId", c.name AS "clientName", b."dueOn", b."outstandingCents"
      FROM charge_balances b
      JOIN "Client" c ON c.id = b."clientId"
      WHERE b."outstandingCents" > 0 AND b.status != 'WRITTEN_OFF' AND b."dueOn" <= ${asOf}
      ORDER BY c.id, b."dueOn" ASC
    `

    const credits = await this.prisma.$queryRaw<Array<{ clientId: string; creditCents: number }>>`
      SELECT "clientId", SUM("creditCents")::int AS "creditCents"
      FROM payment_credits
      WHERE "creditCents" > 0
      GROUP BY "clientId"
    `
    const creditByClient = new Map(credits.map((row) => [row.clientId, row.creditCents]))

    const byClient = new Map<string, { clientName: string; charges: Array<{ dueOn: Date; outstandingCents: number }> }>()
    for (const charge of charges) {
      const entry = byClient.get(charge.clientId) ?? { clientName: charge.clientName, charges: [] }
      entry.charges.push({ dueOn: charge.dueOn, outstandingCents: charge.outstandingCents })
      byClient.set(charge.clientId, entry)
    }

    const rows = []
    for (const [clientId, entry] of byClient) {
      const creditCents = creditByClient.get(clientId) ?? 0
      // `settleOnPaper` (`@ledger-hq/domain`) spends the credit against
      // `entry.charges` oldest due date first and names the first charge it
      // fails to cover in full — that charge, not the oldest debt on the
      // books, is what this client is actually overdue on. Shared with the
      // at-risk report so the two cannot drift apart again.
      const settlement = settleOnPaper(entry.charges, creditCents)

      if (settlement.outstandingCents === 0 || settlement.oldestUncoveredDueOn === null) continue

      const daysOverdue = Math.floor((asOf.getTime() - settlement.oldestUncoveredDueOn.getTime()) / ONE_DAY_MS)
      const ageingBucket = daysOverdue > 90 ? '90+' : daysOverdue > 60 ? '61-90' : daysOverdue > 30 ? '31-60' : '0-30'

      rows.push({
        clientId,
        clientName: entry.clientName,
        grossOutstandingCents: settlement.grossCents,
        creditCents,
        outstandingCents: settlement.outstandingCents,
        oldestDueOn: isoDate(settlement.oldestUncoveredDueOn),
        ageingBucket: ageingBucket as '0-30' | '31-60' | '61-90' | '90+',
      })
    }

    return rows.sort((a, b) => a.oldestDueOn.localeCompare(b.oldestDueOn))
  }

  /**
   * "Who has paid for the period they are currently being billed for."
   *
   * The period label cannot be derived from `asOf` alone: `labelFor` writes
   * `2026-Q1` for a QUARTERLY plan and `2026` for an ANNUAL one, so a
   * hardcoded `YYYY-MM` filter never matched those plans and reported every
   * non-monthly client as paid, whatever they owed. Each plan's own current
   * period comes from the same `chargePeriodsSince` the generator uses, so
   * this view and the charges it reads about can never disagree on what the
   * current period is called.
   */
  async getCurrentMonth(asOf: Date): Promise<Array<{ clientId: string; clientName: string; paid: boolean; outstandingCents: number }>> {
    // `validFrom`/`validTo` are DATE columns; comparing them against a
    // timestamp would drop a plan on its own final day, so compare dates.
    const asOfDate = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()))

    const plans = await this.prisma.retainerPlan.findMany({
      where: {
        validFrom: { lte: asOfDate },
        OR: [{ validTo: null }, { validTo: { gte: asOfDate } }],
        client: { archivedAt: null },
      },
      include: { client: { select: { id: true, name: true } } },
    })
    if (plans.length === 0) return []

    const balances = await this.prisma.$queryRaw<Array<{ clientId: string; periodLabel: string | null; outstandingCents: number }>>`
      SELECT "clientId", "periodLabel", SUM("outstandingCents")::int AS "outstandingCents"
      FROM charge_balances
      WHERE kind = 'RETAINER' AND status != 'WRITTEN_OFF'
      GROUP BY "clientId", "periodLabel"
    `
    const outstandingByClientPeriod = new Map(balances.map((row) => [`${row.clientId}|${row.periodLabel}`, row.outstandingCents]))

    return plans.map((plan) => {
      const currentPeriod = chargePeriodsSince(plan.periodicity, plan.validFrom, asOfDate).at(-1)
      const outstandingCents = currentPeriod ? (outstandingByClientPeriod.get(`${plan.clientId}|${currentPeriod.label}`) ?? 0) : 0
      return { clientId: plan.clientId, clientName: plan.client.name, paid: outstandingCents === 0, outstandingCents }
    })
  }

  /**
   * A write-off "leaves receivables without leaving history" (master spec
   * §8.2), so the charge stays on this ledger and a third entry type cancels
   * whatever was still outstanding on it. Without that entry the balance here
   * still counted forgiven debt as owed, and the client's own page contradicted
   * the receivables list, which has always excluded written-off charges.
   */
  async getClientLedger(clientId: string): Promise<{ entries: LedgerEntry[]; balanceCents: number; availableCreditCents: number }> {
    const credit = await this.getAvailableCredit(clientId)
    const charges = await this.prisma.charge.findMany({ where: { clientId }, orderBy: { issuedOn: 'asc' } })
    const payments = await this.prisma.payment.findMany({ where: { clientId }, orderBy: { receivedOn: 'asc' } })
    const allocations = await this.prisma.paymentAllocation.groupBy({
      by: ['chargeId'],
      where: { charge: { clientId } },
      _sum: { amountCents: true },
    })
    const allocatedByCharge = new Map(allocations.map((row) => [row.chargeId, row._sum.amountCents ?? 0]))

    const writeOffs = charges
      .filter((charge) => charge.writtenOffAt !== null)
      .map((charge) => ({
        type: 'WRITE_OFF' as const,
        date: charge.writtenOffAt!,
        description: charge.writeOffReason ?? '',
        // Only what was still open is forgiven — a partially paid charge that
        // is later written off must not credit back the part already paid.
        amountCents: -(charge.amountCents - (allocatedByCharge.get(charge.id) ?? 0)),
        chargeId: charge.id,
        writtenOff: true,
      }))

    const events = [
      ...charges.map((charge) => ({
        type: 'CHARGE' as const,
        date: charge.issuedOn,
        description: charge.description,
        amountCents: charge.amountCents,
        chargeId: charge.id,
        writtenOff: charge.writtenOffAt !== null,
      })),
      ...payments.map((payment) => ({
        type: 'PAYMENT' as const,
        date: payment.receivedOn,
        description: `Pagamento — ${payment.method}`,
        amountCents: -payment.amountCents,
        chargeId: null,
        writtenOff: false,
      })),
      ...writeOffs,
    ].sort((a, b) => a.date.getTime() - b.date.getTime())

    let runningBalanceCents = 0
    const entries = events.map((event) => {
      runningBalanceCents += event.amountCents
      return {
        type: event.type,
        date: isoDate(event.date),
        description: event.description,
        amountCents: event.amountCents,
        runningBalanceCents,
        chargeId: event.chargeId,
        writtenOff: event.writtenOff,
      }
    })

    return { entries, balanceCents: runningBalanceCents, availableCreditCents: credit.totalCents }
  }
}
