import { Injectable } from '@nestjs/common'
import { settleOnPaper } from '@ledger-hq/domain'
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
  unappliedCreditAtCloseCents: number
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
   * `settleOnPaper` (`@ledger-hq/domain`) spends the credit against them —
   * the same walk `getReceivables` uses, extracted so the two cannot drift
   * apart again the way they already have once.
   */
  async atRisk(asOf: Date): Promise<AtRiskRow[]> {
    // Aggregated per client, not joined against balances: this alone
    // carries no fan-out risk, since nothing here multiplies against
    // another table's rows. Excludes archived clients up front — `getReceivables`
    // does not filter on `archivedAt` at all, so an archived client still
    // carrying debt can appear on the receivables screen but never here.
    // That is a deliberate divergence, not an oversight: whether an
    // archived client's debt belongs on the main receivables screen is a
    // question for the practice, not one this report should settle by
    // silently hiding real debt (see the spec's open-questions note, §3.7).
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
      const creditCents = creditByClient.get(entry.clientId) ?? 0
      const settlement = settleOnPaper(clientCharges, creditCents)

      // A client whose own unspent money covers its debt is not in
      // arrears, whatever the gross figure says.
      if (settlement.outstandingCents === 0 || settlement.oldestUncoveredDueOn === null) continue

      rows.push({
        clientId: entry.clientId,
        clientName: entry.clientName,
        overdueObligations: entry.overdueObligations,
        oldestDueDate: isoDate(entry.oldestDueDate),
        grossOutstandingCents: settlement.grossCents,
        creditCents,
        outstandingCents: settlement.outstandingCents,
        oldestChargeDueOn: isoDate(settlement.oldestUncoveredDueOn),
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
   * today: it counts only allocations that existed by then, so a charge
   * settled the month after the quarter closed still shows as outstanding
   * in that quarter's summary. Reporting today's balance under a past
   * period's heading would make every historical summary change as new
   * money arrives.
   *
   * That "existed by then" test is the allocation's own `createdAt`, not
   * the payment's `receivedOn`. `BillingService#applyCredit` can write an
   * allocation against a payment long after that payment was received —
   * that is the whole point of unspent credit — so keying off `receivedOn`
   * would let a credit application made after a period closed silently
   * settle a charge inside it, changing that period's answer depending on
   * when it's asked. `createdAt` is the only timestamp that actually says
   * when the allocation — the event that spends the money — happened.
   *
   * `outstandingAtCloseCents` answers a different question from the
   * receivables screen and the at-risk report: it is gross of credit,
   * counts every client including archived ones, and includes charges not
   * yet due at `to`. It cannot be reconciled against either of those
   * net, due-only, active-clients-only figures on its own.
   * `unappliedCreditAtCloseCents` — unspent payment money at the same
   * instant, by the same "as it stood at `to`" rule — is what bridges the
   * gap: gross outstanding minus unapplied credit gets an operator most of
   * the way to what the receivables screen would call net (it still won't
   * match exactly, since receivables excludes charges not yet due and this
   * figure does not), rather than leaving them to wonder why the two
   * screens disagree.
   */
  async periodSummary(from: Date, to: Date): Promise<PeriodSummary> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        obligationsDue: number
        obligationsDone: number
        chargesIssuedCents: number
        paymentsReceivedCents: number
        outstandingAtCloseCents: number
        unappliedCreditAtCloseCents: number
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
      -- Only allocations actually written by close count against a charge —
      -- keyed on the allocation's own createdAt, not the payment's
      -- receivedOn: credit applied to a charge after the window closed
      -- must not retroactively settle it (see the method doc). Cast to
      -- date, the same as writtenOffAt above: createdAt is a timestamp, and
      -- "to" is midnight at the start of the closing day, so a bare <=
      -- would wrongly exclude an allocation made later that same day.
      settled AS (
        SELECT "chargeId", SUM("amountCents")::int AS "allocatedCents"
        FROM "PaymentAllocation"
        WHERE "createdAt"::date <= ${to}
        GROUP BY "chargeId"
      ),
      closing AS (
        SELECT COALESCE(SUM(GREATEST(i."amountCents" - COALESCE(s."allocatedCents", 0), 0)), 0)::int AS "outstandingAtCloseCents"
        FROM issued i
        LEFT JOIN settled s ON s."chargeId" = i.id
      ),
      -- Unspent payment money at close: every cent received by close, minus
      -- every cent allocated by close (the same createdAt-keyed rule the
      -- 'settled' CTE above uses, so this cannot disagree with it). Not
      -- scoped to charges in 'issued' -- a payment's own existence, not any
      -- one charge's, is what makes its unspent remainder credit.
      receivedByClose AS (
        SELECT COALESCE(SUM("amountCents"), 0)::int AS "receivedCents"
        FROM "Payment"
        WHERE "receivedOn" <= ${to}
      ),
      allocatedByClose AS (
        SELECT COALESCE(SUM("amountCents"), 0)::int AS "allocatedCents"
        FROM "PaymentAllocation"
        WHERE "createdAt"::date <= ${to}
      ),
      unapplied AS (
        SELECT GREATEST(r."receivedCents" - a."allocatedCents", 0)::int AS "unappliedCreditAtCloseCents"
        FROM receivedByClose r, allocatedByClose a
      )
      SELECT o."obligationsDue", o."obligationsDone", ch."chargesIssuedCents",
             p."paymentsReceivedCents", cl."outstandingAtCloseCents", u."unappliedCreditAtCloseCents"
      FROM obligations o, charges ch, payments p, closing cl, unapplied u
    `

    return {
      from: isoDate(from),
      to: isoDate(to),
      obligationsDue: row?.obligationsDue ?? 0,
      obligationsDone: row?.obligationsDone ?? 0,
      chargesIssuedCents: row?.chargesIssuedCents ?? 0,
      paymentsReceivedCents: row?.paymentsReceivedCents ?? 0,
      outstandingAtCloseCents: row?.outstandingAtCloseCents ?? 0,
      unappliedCreditAtCloseCents: row?.unappliedCreditAtCloseCents ?? 0,
    }
  }
}
