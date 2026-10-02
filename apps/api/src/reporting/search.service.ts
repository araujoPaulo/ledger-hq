import { Injectable } from '@nestjs/common'
import { toTsQuery } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'

export type SearchHit = {
  type: 'client' | 'platform' | 'obligation' | 'charge'
  id: string
  label: string
  /** The owning client, for a hit that only makes sense underneath one. */
  context: string | null
  /** The app route that opens it. */
  href: string
  rank: number
}

/** Per type, so one broad term never drags four whole tables into this process. */
const PER_TYPE_LIMIT = 10
const OVERALL_LIMIT = 25

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One flat ranked list across four tables (design §3.5). Credentials are
   * absent by construction, not by filter: the vault is zero-knowledge, the
   * server holds ciphertext it has no key for, and `Credential.label` is a
   * per-client disambiguator that carries no meaning away from the client
   * row which would already have matched (§3.1).
   */
  async search(q: string): Promise<Array<SearchHit & { typeRank: number }>> {
    const tsquery = toTsQuery(q)
    // Nothing searchable was typed. An operator holding down backspace is
    // not a failure, so this is an empty list and a 200, not an error.
    if (tsquery === null) return []

    // `typeRank` is a fixed per-type tiebreak, so a client outranks a charge
    // that scores the same. Each branch caps itself; the outer query caps
    // the union.
    // The raw rows carry `typeRank`, which orders the union and is not
    // part of the response; the controller drops it.
    const rows = await this.prisma.$queryRaw<Array<SearchHit & { typeRank: number }>>`
      (
        SELECT 'client' AS type, c.id::text AS id, c.name AS label, NULL::text AS context,
               '/clients/' || c.id::text AS href,
               ts_rank_cd(c."searchVector", to_tsquery('portuguese_unaccent', ${tsquery})) AS rank,
               1 AS "typeRank"
        FROM "Client" c
        WHERE c."searchVector" @@ to_tsquery('portuguese_unaccent', ${tsquery})
          AND c."archivedAt" IS NULL
        ORDER BY rank DESC, label ASC
        LIMIT ${PER_TYPE_LIMIT}
      )
      UNION ALL
      (
        SELECT 'platform' AS type, p.id::text AS id, p.name AS label, NULL::text AS context,
               '/vault/platforms' AS href,
               ts_rank_cd(p."searchVector", to_tsquery('portuguese_unaccent', ${tsquery})) AS rank,
               2 AS "typeRank"
        FROM "Platform" p
        WHERE p."searchVector" @@ to_tsquery('portuguese_unaccent', ${tsquery})
        ORDER BY rank DESC, label ASC
        LIMIT ${PER_TYPE_LIMIT}
      )
      UNION ALL
      (
        -- Either vector matches: the readable name is on the definition, the
        -- period and reference on the instance, because a generated column
        -- can only reference its own row.
        SELECT 'obligation' AS type, i.id::text AS id, d.name || ' · ' || i."periodLabel" AS label,
               c.name AS context,
               '/clients/' || i."clientId"::text AS href,
               GREATEST(
                 ts_rank_cd(i."searchVector", to_tsquery('portuguese_unaccent', ${tsquery})),
                 ts_rank_cd(d."searchVector", to_tsquery('portuguese_unaccent', ${tsquery}))
               ) AS rank,
               3 AS "typeRank"
        FROM "ObligationInstance" i
        JOIN "ObligationDefinition" d ON d.code = i."definitionCode"
        JOIN "Client" c ON c.id = i."clientId"
        WHERE (i."searchVector" @@ to_tsquery('portuguese_unaccent', ${tsquery})
            OR d."searchVector" @@ to_tsquery('portuguese_unaccent', ${tsquery}))
          AND c."archivedAt" IS NULL
        ORDER BY rank DESC, label ASC
        LIMIT ${PER_TYPE_LIMIT}
      )
      UNION ALL
      (
        -- Written-off charges are included: looking one up is a legitimate
        -- reason to search, and the ledger still shows it.
        SELECT 'charge' AS type, ch.id::text AS id, ch.description AS label,
               c.name AS context,
               '/clients/' || ch."clientId"::text AS href,
               ts_rank_cd(ch."searchVector", to_tsquery('portuguese_unaccent', ${tsquery})) AS rank,
               4 AS "typeRank"
        FROM "Charge" ch
        JOIN "Client" c ON c.id = ch."clientId"
        WHERE ch."searchVector" @@ to_tsquery('portuguese_unaccent', ${tsquery})
          AND c."archivedAt" IS NULL
        ORDER BY rank DESC, label ASC
        LIMIT ${PER_TYPE_LIMIT}
      )
      ORDER BY rank DESC, "typeRank" ASC, label ASC
      LIMIT ${OVERALL_LIMIT}
    `

    return rows
  }
}
