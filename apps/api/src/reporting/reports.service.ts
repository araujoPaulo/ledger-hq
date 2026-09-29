import { Injectable } from '@nestjs/common'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'

export type AtRiskRow = {
  clientId: string
  clientName: string
  overdueObligations: number
  oldestDueDate: string
  grossOutstandingCents: number
  creditCents: number
  outstandingCents: number
  oldestChargeDueOn: string
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Clients both overdue on a statutory deadline and behind on payment
   * (design §3.7) — the cross-module question neither the obligations
   * dashboard nor the receivables list can answer alone, and the reason this
   * module exists.
   *
   * The overdue test is `dueDate < asOf` on a still-open status, the same
   * definition `groupByUrgency`'s `overdue` bucket uses; the arrears side
   * uses `getReceivables`'s filters and nets credit as Phase 4a does. So this
   * report cannot disagree with either screen.
   *
   * `oldestChargeDueOn` in particular must name the same charge
   * `getReceivables` (`billing.service.ts`) points the operator at, not
   * merely the oldest charge on file: a `MIN(dueOn)` over the raw balances
   * would name a charge the client's own unspent credit has already
   * answered. So charges are fetched per row, not pre-aggregated, and
   * credit is spent against them on paper — oldest charge first, same as a
   * real allocation — keeping the first charge it fails to cover in full.
   * A charge the credit only partially reaches is still the oldest
   * uncovered one and must not be skipped past.
   */
  async atRisk(asOf: Date): Promise<AtRiskRow[]> {
    // Aggregated per client, not joined against balances: this alone
    // carries no fan-out risk, since nothing here multiplies against
    // another table's rows. Excludes archived clients up front, same as
    // `getReceivables`.
    const overdue = await this.prisma.$queryRaw<
      Array<{ clientId: string; clientName: string; overdueObligations: number; oldestDueDate: Date }>
    >`
      SELECT o."clientId", c.name AS "clientName",
             COUNT(*)::int AS "overdueObligations", MIN(o."dueDate") AS "oldestDueDate"
      FROM "ObligationInstance" o
      JOIN "Client" c ON c.id = o."clientId"
      WHERE o.status IN ('PENDING', 'IN_PROGRESS') AND o."dueDate" < ${asOf} AND c."archivedAt" IS NULL
      GROUP BY o."clientId", c.name
    `
    if (overdue.length === 0) return []

    // Per charge, not pre-aggregated — mirrors `BillingService#openChargesFor`
    // / `getReceivables`, so the credit walk below can name the same charge
    // the receivables screen would.
    const charges = await this.prisma.$queryRaw<Array<{ clientId: string; dueOn: Date; outstandingCents: number }>>`
      SELECT "clientId", "dueOn", "outstandingCents"
      FROM charge_balances
      WHERE "outstandingCents" > 0 AND status != 'WRITTEN_OFF' AND "dueOn" <= ${asOf}
      ORDER BY "clientId", "dueOn" ASC
    `

    const credits = await this.prisma.$queryRaw<Array<{ clientId: string; creditCents: number }>>`
      SELECT "clientId", SUM("creditCents")::int AS "creditCents"
      FROM payment_credits
      WHERE "creditCents" > 0
      GROUP BY "clientId"
    `
    const creditByClient = new Map(credits.map((row) => [row.clientId, row.creditCents]))

    const chargesByClient = new Map<string, Array<{ dueOn: Date; outstandingCents: number }>>()
    for (const charge of charges) {
      const list = chargesByClient.get(charge.clientId) ?? []
      list.push({ dueOn: charge.dueOn, outstandingCents: charge.outstandingCents })
      chargesByClient.set(charge.clientId, list)
    }

    const rows: AtRiskRow[] = []
    for (const entry of overdue) {
      const clientCharges = chargesByClient.get(entry.clientId) ?? []
      const grossOutstandingCents = clientCharges.reduce((sum, charge) => sum + charge.outstandingCents, 0)
      const creditCents = creditByClient.get(entry.clientId) ?? 0

      // Spend the credit on paper, oldest charge first — the same order
      // `getReceivables` (and a real allocation) would use — and keep the
      // first charge it fails to cover in full. A partially covered charge
      // is still the oldest uncovered one, so it is kept, not skipped.
      let remainingCredit = creditCents
      let oldestUncovered: Date | null = null
      for (const charge of clientCharges) {
        if (remainingCredit >= charge.outstandingCents) {
          remainingCredit -= charge.outstandingCents
          continue
        }
        oldestUncovered = charge.dueOn
        break
      }

      const outstandingCents = Math.max(grossOutstandingCents - creditCents, 0)
      // A client whose own unspent money covers its debt is not in
      // arrears, whatever the gross figure says.
      if (outstandingCents === 0 || oldestUncovered === null) continue

      rows.push({
        clientId: entry.clientId,
        clientName: entry.clientName,
        overdueObligations: entry.overdueObligations,
        oldestDueDate: isoDate(entry.oldestDueDate),
        grossOutstandingCents,
        creditCents,
        outstandingCents,
        oldestChargeDueOn: isoDate(oldestUncovered),
      })
    }

    return rows.sort((a, b) => b.outstandingCents - a.outstandingCents || a.oldestDueDate.localeCompare(b.oldestDueDate))
  }
}
