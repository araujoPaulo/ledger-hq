import { Injectable } from '@nestjs/common'
import type { Client, Employment } from '../generated/prisma/client.js'
import { Prisma } from '../generated/prisma/client.js'
import { uuidv7 } from 'uuidv7'
import { AppError } from '@ledger-hq/domain'
import type { CreateEmploymentInput } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ClientsService } from '../clients/clients.service.js'

export type EmploymentWithNames = Employment & {
  employer: Pick<Client, 'name'>
  employee: Pick<Client, 'name'>
}

const WITH_NAMES = {
  employer: { select: { name: true } },
  employee: { select: { name: true } },
} as const

@Injectable()
export class EmploymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
  ) {}

  async create(input: CreateEmploymentInput): Promise<EmploymentWithNames> {
    const employer = await this.clients.findOne(input.employerId)
    const employee = await this.clients.findOne(input.employeeId)

    if (employer.kind !== 'COMPANY') {
      throw new AppError('employment.employer_must_be_company', {}, 422)
    }

    if (employee.kind !== 'INDIVIDUAL') {
      throw new AppError('employment.employee_must_be_individual', {}, 422)
    }

    await this.assertNoOverlap(input.employerId, input.employeeId, input.startedOn, input.endedOn ?? null)

    try {
      return await this.prisma.employment.create({
        data: {
          id: uuidv7(),
          employerId: input.employerId,
          employerKind: 'COMPANY',
          employeeId: input.employeeId,
          employeeKind: 'INDIVIDUAL',
          startedOn: toDate(input.startedOn),
          endedOn: input.endedOn === undefined ? null : toDate(input.endedOn),
          jobTitle: input.jobTitle ?? null,
          notes: input.notes ?? null,
        },
        include: WITH_NAMES,
      })
    } catch (error) {
      throw toOverlapConflictOr(error)
    }
  }

  async listForClient(clientId: string): Promise<EmploymentWithNames[]> {
    await this.clients.findOne(clientId)

    return this.prisma.employment.findMany({
      where: { OR: [{ employerId: clientId }, { employeeId: clientId }] },
      include: WITH_NAMES,
      orderBy: { startedOn: 'desc' },
    })
  }

  async end(id: string, endedOn: string): Promise<EmploymentWithNames> {
    const existing = await this.prisma.employment.findUnique({ where: { id } })
    if (!existing) throw new AppError('common.not_found', {}, 404)

    if (toDate(endedOn) < existing.startedOn) {
      throw new AppError('employment.ended_before_started', {}, 422)
    }

    return this.prisma.employment.update({
      where: { id },
      data: { endedOn: toDate(endedOn) },
      include: WITH_NAMES,
    })
  }

  /**
   * Checked here so the API can name the problem. The GiST exclusion
   * constraint in the database (`employment_no_overlap`, added in Task 7)
   * remains the authoritative guard: this check-then-act read can lose a
   * race, which is why `create` also catches the constraint violation below.
   */
  private async assertNoOverlap(
    employerId: string,
    employeeId: string,
    startedOn: string,
    endedOn: string | null,
  ): Promise<void> {
    const start = toDate(startedOn)
    const end = endedOn === null ? null : toDate(endedOn)

    const clash = await this.prisma.employment.findFirst({
      where: {
        employerId,
        employeeId,
        ...(end === null ? {} : { startedOn: { lte: end } }),
        OR: [{ endedOn: null }, { endedOn: { gte: start } }],
      },
    })

    if (clash) throw new AppError('employment.overlapping_spell', {}, 409)
  }
}

function toDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`)
}

/**
 * `assertNoOverlap`'s check-then-act read is only the friendly path: two
 * concurrent writes can both pass it before either commits. This closes the
 * gap by turning the database's own exclusion-constraint violation — the
 * guarantee that actually holds — into the same domain error, instead of
 * letting it fall through to the catch-all filter as an opaque 500.
 *
 * Empirically (via the `@prisma/adapter-pg` driver adapter this project
 * uses), a Postgres EXCLUDE constraint violation does not surface as one of
 * Prisma's usual mapped codes (e.g. `P2002` for unique, `P2003` for foreign
 * keys). It comes back as `PrismaClientKnownRequestError` with code
 * `P2039` ("driver adapter error"), wrapping the raw Postgres error — SQLSTATE
 * `23P01` ("exclusion_violation") — in `error.meta.driverAdapterError.cause`.
 * We check both the SQLSTATE and the constraint name in the underlying
 * message, the same way `clients.service.ts` checks *which* unique
 * constraint fired rather than blanket-mapping every `P2002`.
 */
function toOverlapConflictOr(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2039' && isOverlapViolation(error.meta)) {
    return new AppError('employment.overlapping_spell', {}, 409)
  }

  return error
}

function isOverlapViolation(meta: Record<string, unknown> | undefined): boolean {
  const cause = (meta?.driverAdapterError as { cause?: { code?: string; message?: string } } | undefined)?.cause
  return cause?.code === '23P01' && typeof cause.message === 'string' && cause.message.includes('employment_no_overlap')
}
