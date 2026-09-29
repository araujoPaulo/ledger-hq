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

export type PeriodSummary = {
  from: string
  to: string
  obligationsDue: number
  obligationsDone: number
  chargesIssuedCents: number
  paymentsReceivedCents: number
  outstandingAtCloseCents: number
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

  /**
   * What a window contained (design §3.7). Every figure already exists in
   * Phase 2 and Phase 3 data — a window and four aggregates, no new derived
   * state.
   *
   * `outstandingAtCloseCents` reconstructs the position **at `to`**, not
   * today: it counts only allocations from payments received by then, so a
   * charge settled the month after the quarter closed still shows as
   * outstanding in that quarter's summary. Reporting today's balance under a
   * past period's heading would make every historical summary change as new
   * money arrives.
   */
  async periodSummary(from: Date, to: Date): Promise<PeriodSummary> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        obligationsDue: number
        obligationsDone: number
        chargesIssuedCents: number
        paymentsReceivedCents: number
        outstandingAtCloseCents: number
      }>
    >`
      WITH obligations AS (
        SELECT
          COUNT(*)::int AS "obligationsDue",
          COUNT(*) FILTER (WHERE status = 'DONE')::int AS "obligationsDone"
        FROM "ObligationInstance"
        WHERE "dueDate" BETWEEN ${from} AND ${to}
      ),
      charges AS (
        SELECT COALESCE(SUM("amountCents"), 0)::int AS "chargesIssuedCents"
        FROM "Charge"
        WHERE "issuedOn" BETWEEN ${from} AND ${to}
      ),
      payments AS (
        SELECT COALESCE(SUM("amountCents"), 0)::int AS "paymentsReceivedCents"
        FROM "Payment"
        WHERE "receivedOn" BETWEEN ${from} AND ${to}
      ),
      -- Charges that existed at close and had not been forgiven by then.
      issued AS (
        SELECT id, "amountCents"
        FROM "Charge"
        WHERE "issuedOn" <= ${to}
          AND ("writtenOffAt" IS NULL OR "writtenOffAt"::date > ${to})
      ),
      -- Only money that had actually arrived by close counts against them.
      settled AS (
        SELECT a."chargeId", SUM(a."amountCents")::int AS "allocatedCents"
        FROM "PaymentAllocation" a
        JOIN "Payment" p ON p.id = a."paymentId"
        WHERE p."receivedOn" <= ${to}
        GROUP BY a."chargeId"
      ),
      closing AS (
        SELECT COALESCE(SUM(GREATEST(i."amountCents" - COALESCE(s."allocatedCents", 0), 0)), 0)::int AS "outstandingAtCloseCents"
        FROM issued i
        LEFT JOIN settled s ON s."chargeId" = i.id
      )
      SELECT o."obligationsDue", o."obligationsDone", ch."chargesIssuedCents",
             p."paymentsReceivedCents", cl."outstandingAtCloseCents"
      FROM obligations o, charges ch, payments p, closing cl
    `

    return {
      from: isoDate(from),
      to: isoDate(to),
      obligationsDue: row?.obligationsDue ?? 0,
      obligationsDone: row?.obligationsDone ?? 0,
      chargesIssuedCents: row?.chargesIssuedCents ?? 0,
      paymentsReceivedCents: row?.paymentsReceivedCents ?? 0,
      outstandingAtCloseCents: row?.outstandingAtCloseCents ?? 0,
    }
  }
}
