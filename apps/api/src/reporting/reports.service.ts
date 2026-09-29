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
   */
  async atRisk(asOf: Date): Promise<AtRiskRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        clientId: string
        clientName: string
        overdueObligations: number
        oldestDueDate: Date
        grossOutstandingCents: number
        creditCents: number
        outstandingCents: number
        oldestChargeDueOn: Date
      }>
    >`
      -- Three CTEs, not three joins in one pass: joining obligations and
      -- balances directly multiplies each client's rows by the other side's
      -- count and inflates both aggregates. Each aggregate carries ::int
      -- (ADR 0007) — COUNT/SUM over Int return bigint, which the serializer
      -- throws on.
      WITH overdue AS (
        SELECT "clientId", COUNT(*)::int AS "overdueObligations", MIN("dueDate") AS "oldestDueDate"
        FROM "ObligationInstance"
        WHERE status IN ('PENDING', 'IN_PROGRESS') AND "dueDate" < ${asOf}
        GROUP BY "clientId"
      ),
      arrears AS (
        SELECT "clientId", SUM("outstandingCents")::int AS "grossOutstandingCents", MIN("dueOn") AS "oldestChargeDueOn"
        FROM charge_balances
        WHERE "outstandingCents" > 0 AND status != 'WRITTEN_OFF' AND "dueOn" <= ${asOf}
        GROUP BY "clientId"
      ),
      credit AS (
        SELECT "clientId", SUM("creditCents")::int AS "creditCents"
        FROM payment_credits
        WHERE "creditCents" > 0
        GROUP BY "clientId"
      )
      SELECT c.id AS "clientId", c.name AS "clientName",
             o."overdueObligations", o."oldestDueDate",
             a."grossOutstandingCents",
             COALESCE(cr."creditCents", 0) AS "creditCents",
             GREATEST(a."grossOutstandingCents" - COALESCE(cr."creditCents", 0), 0) AS "outstandingCents",
             a."oldestChargeDueOn"
      FROM "Client" c
      JOIN overdue o ON o."clientId" = c.id
      JOIN arrears a ON a."clientId" = c.id
      LEFT JOIN credit cr ON cr."clientId" = c.id
      WHERE c."archivedAt" IS NULL
        -- A client whose own unspent money covers its debt is not in
        -- arrears, whatever the gross figure says.
        AND GREATEST(a."grossOutstandingCents" - COALESCE(cr."creditCents", 0), 0) > 0
      ORDER BY "outstandingCents" DESC, o."oldestDueDate" ASC
    `

    return rows.map((row) => ({
      ...row,
      oldestDueDate: isoDate(row.oldestDueDate),
      oldestChargeDueOn: isoDate(row.oldestChargeDueOn),
    }))
  }
}
