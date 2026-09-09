import { Injectable } from '@nestjs/common'
import type { FiscalProfile } from '../generated/prisma/client.js'
import { AppError, checkFiscalProfileConsistency } from '@ledger-hq/domain'
import type { ErrorCode, FiscalProfileInput } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ClientsService } from '../clients/clients.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { AuditService } from '../audit/audit.service.js'

/** Maps each consistency rule to the field a form should highlight. */
const FIELD_FOR_CODE: Record<string, string> = {
  'fiscal_profile.open_activity_required_for_company': 'hasOpenActivity',
  'fiscal_profile.vat_regime_requires_open_activity': 'vatRegime',
  'fiscal_profile.income_tax_incompatible_with_kind': 'incomeTax',
  'fiscal_profile.employees_flag_not_allowed_for_individual': 'hasEmployees',
}

@Injectable()
export class FiscalProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
  ) {}

  async get(clientId: string): Promise<FiscalProfile> {
    await this.clients.findOne(clientId)

    const profile = await this.prisma.fiscalProfile.findUnique({ where: { clientId } })
    if (!profile) throw new AppError('common.not_found', {}, 404)

    return profile
  }

  async upsert(clientId: string, input: FiscalProfileInput): Promise<FiscalProfile> {
    const client = await this.clients.findOne(clientId)

    const violations = checkFiscalProfileConsistency(client.kind, input)
    if (violations.length > 0) throw validationError(violations)

    const before = await this.prisma.fiscalProfile.findUnique({ where: { clientId } })
    const data = { ...input, startedAt: new Date(`${input.startedAt}T00:00:00Z`) }

    const profile = await this.prisma.fiscalProfile.upsert({
      where: { clientId },
      create: { clientId, ...data },
      update: data,
    })

    await this.audit.record({
      entityType: 'FiscalProfile',
      entityId: clientId,
      action: before ? 'fiscal_profile.changed' : 'fiscal_profile.created',
      metadata: { changed: diff(before, profile) },
    })

    return profile
  }
}

function validationError(codes: ErrorCode[]): AppError {
  const issues = codes.map((code) => ({ path: FIELD_FOR_CODE[code] ?? '', code }))
  return new AppError('common.validation_failed', { issues }, 422)
}

/** The only shapes a fiscal profile field can take once serialized for the audit log. */
type JsonPrimitive = string | number | boolean | null

/** Field-level before/after, so the audit log says what actually moved. */
function diff(
  before: FiscalProfile | null,
  after: FiscalProfile,
): Record<string, { from: JsonPrimitive; to: JsonPrimitive }> {
  if (!before) return {}

  const changed: Record<string, { from: JsonPrimitive; to: JsonPrimitive }> = {}

  for (const [key, value] of Object.entries(after)) {
    if (key === 'updatedAt' || key === 'clientId') continue

    const previous = (before as Record<string, unknown>)[key]

    const from = (previous instanceof Date ? previous.toISOString() : previous) as JsonPrimitive
    const to = (value instanceof Date ? value.toISOString() : value) as JsonPrimitive

    if (from !== to) changed[key] = { from, to }
  }

  return changed
}
