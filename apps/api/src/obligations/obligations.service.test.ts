import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../common/prisma.service.js'
import type { ClientsService } from '../clients/clients.service.js'
import { ObligationsService } from './obligations.service.js'

function fakePrisma(overrides: Record<string, unknown> = {}): PrismaService {
  return {
    obligationDefinition: { upsert: vi.fn().mockResolvedValue({}) },
    client: { findMany: vi.fn().mockResolvedValue([]) },
    fiscalProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    obligationInstance: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    ...overrides,
  } as unknown as PrismaService
}

function fakeClientsService(client: unknown): ClientsService {
  return { findOne: vi.fn().mockResolvedValue(client) } as unknown as ClientsService
}

const COMPANY_PROFILE = {
  hasOpenActivity: true,
  vatRegime: 'MONTHLY',
  incomeTax: 'CIT',
  hasEmployees: false,
  hasWithholding: false,
  isVatCashBasis: false,
}

describe('ObligationsService#syncCatalogDefinitions', () => {
  it('upserts one definition per catalog entry', async () => {
    const prisma = fakePrisma()
    const service = new ObligationsService(prisma, fakeClientsService(null))

    await service.syncCatalogDefinitions()

    expect(vi.mocked(prisma.obligationDefinition.upsert)).toHaveBeenCalledTimes(18)
  })
})

describe('ObligationsService#generate', () => {
  const client = { id: 'c1', kind: 'COMPANY', archivedAt: null }

  it('generates nothing for a client with no fiscal profile', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      fiscalProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    })
    const service = new ObligationsService(prisma, fakeClientsService(client))

    const result = await service.generate({ asOf: new Date('2026-03-18T00:00:00Z') }, true)

    expect(result.toCreate).toEqual([])
  })

  it('is idempotent: a second dry run against the same already-created instances proposes nothing new', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      fiscalProfile: { findUnique: vi.fn().mockResolvedValue(COMPANY_PROFILE) },
    })
    const service = new ObligationsService(prisma, fakeClientsService(client))
    const asOf = new Date('2026-03-18T00:00:00Z')

    const first = await service.generate({ asOf, clientId: 'c1' }, true)
    expect(first.toCreate.length).toBeGreaterThan(0)

    // Simulate the first run having been applied: mock `findMany` to report
    // exactly the instances the first dry run proposed, so the second call
    // sees them as already existing, keyed by `periodStart` the same way
    // the service itself keys them (every label this catalog produces is
    // "YYYY-MM", "YYYY-QN", or "YYYY").
    function periodStartFor(label: string): Date {
      if (/^\d{4}-\d{2}$/.test(label)) return new Date(`${label}-01T00:00:00Z`)
      if (/^\d{4}-Q\d$/.test(label)) {
        const [year, q] = label.split('-Q')
        const month = (Number(q) - 1) * 3 + 1
        return new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00Z`)
      }
      return new Date(`${label}-01-01T00:00:00Z`)
    }

    vi.mocked(prisma.obligationInstance.findMany).mockResolvedValue(
      first.toCreate.map((item) => ({
        id: 'x',
        clientId: 'c1',
        definitionCode: item.definitionCode,
        periodStart: periodStartFor(item.periodLabel),
        status: 'PENDING',
      })) as never,
    )

    const second = await service.generate({ asOf, clientId: 'c1' }, true)
    expect(second.toCreate).toEqual([])
  })

  it('never proposes an instance whose period ends more than 3 months before asOf', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      fiscalProfile: { findUnique: vi.fn().mockResolvedValue(COMPANY_PROFILE) },
    })
    const service = new ObligationsService(prisma, fakeClientsService(client))

    const result = await service.generate({ asOf: new Date('2026-03-18T00:00:00Z'), clientId: 'c1' }, true)

    for (const item of result.toCreate) {
      // Every MONTHLY/QUARTERLY period label in the result must be no
      // earlier than December 2025 (3 months before March 2026). ANNUAL
      // periods use a bare "YYYY" label (e.g. "2025"), which is not
      // comparable the same way — a still-open 2025 annual filing (due
      // mid-2026) is correctly proposed even though "2025" < "2025-12"
      // as a string, so this check is scoped to "YYYY-MM"/"YYYY-QN" labels.
      if (/^\d{4}-/.test(item.periodLabel)) {
        expect(item.periodLabel >= '2025-12').toBe(true)
      }
    }
  })

  it('retracts a future PENDING instance whose rule no longer applies, once the profile changes', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      fiscalProfile: {
        // hasEmployees flips to false — a payroll-only rule would stop
        // applying. This plan's initial catalog has no employee-gated rule,
        // so this test uses vatRegime flipping to NOT_APPLICABLE instead,
        // which retracts every VAT-conditioned instance.
        findUnique: vi.fn().mockResolvedValue({ ...COMPANY_PROFILE, hasOpenActivity: false, vatRegime: 'NOT_APPLICABLE' }),
      },
      obligationInstance: {
        findMany: vi.fn().mockResolvedValue([
          // April 2026 — still ahead of asOf (18 March 2026), i.e. genuinely
          // future, unresolved work the rule change should retract. A period
          // that has already ended by asOf is arrears, not future work — see
          // the "never retracts a stale PENDING arrears instance" test below.
          { id: 'existing-1', clientId: 'c1', definitionCode: 'VAT_MONTHLY_RETURN', periodStart: new Date('2026-04-01T00:00:00Z'), periodEnd: new Date('2026-04-30T00:00:00Z'), periodLabel: '2026-04', status: 'PENDING' },
        ]),
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    })
    const service = new ObligationsService(prisma, fakeClientsService(client))

    const result = await service.generate({ asOf: new Date('2026-03-18T00:00:00Z'), clientId: 'c1' }, true)

    expect(result.toRetract).toContainEqual({ clientId: 'c1', definitionCode: 'VAT_MONTHLY_RETURN', periodLabel: expect.any(String) })
  })

  it('never retracts a stale PENDING arrears instance whose period already ended, even when the rule still applies unchanged', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      fiscalProfile: { findUnique: vi.fn().mockResolvedValue(COMPANY_PROFILE) },
      obligationInstance: {
        findMany: vi.fn().mockResolvedValue([
          // Genuine long-standing arrears: this period ended almost two
          // years before asOf, well outside the generator's [floor,
          // horizonEnd] window, so it isn't in `periodKeys` even though the
          // rule (VAT_MONTHLY_RETURN, COMPANY_PROFILE) still applies
          // unchanged. Master spec §7.3, invariant 4: "retracts forward
          // only ... past and already-handled ones remain." Falling outside
          // the window must never be conflated with "the rule no longer
          // applies" — this exact confusion was a real bug (see Task 10's
          // review).
          { id: 'arrears-1', clientId: 'c1', definitionCode: 'VAT_MONTHLY_RETURN', periodStart: new Date('2024-06-01T00:00:00Z'), periodEnd: new Date('2024-06-30T00:00:00Z'), periodLabel: '2024-06', status: 'PENDING' },
        ]),
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    })
    const service = new ObligationsService(prisma, fakeClientsService(client))

    const result = await service.generate({ asOf: new Date('2026-03-18T00:00:00Z'), clientId: 'c1' }, true)

    expect(result.toRetract).toEqual([])
  })

  it('never touches an instance whose status is not PENDING, even when its rule no longer applies', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      fiscalProfile: {
        findUnique: vi.fn().mockResolvedValue({ ...COMPANY_PROFILE, hasOpenActivity: false, vatRegime: 'NOT_APPLICABLE' }),
      },
      obligationInstance: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'done-1', clientId: 'c1', definitionCode: 'VAT_MONTHLY_RETURN', periodStart: new Date('2026-01-01T00:00:00Z'), periodLabel: '2026-01', status: 'DONE' },
        ]),
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    })
    const service = new ObligationsService(prisma, fakeClientsService(client))

    const result = await service.generate({ asOf: new Date('2026-03-18T00:00:00Z'), clientId: 'c1' }, true)

    expect(result.toRetract).toEqual([])
  })

  it('dry run never calls create or deleteMany', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      fiscalProfile: { findUnique: vi.fn().mockResolvedValue(COMPANY_PROFILE) },
    })
    const service = new ObligationsService(prisma, fakeClientsService(client))

    await service.generate({ asOf: new Date('2026-03-18T00:00:00Z'), clientId: 'c1' }, true)

    expect(prisma.obligationInstance.create).not.toHaveBeenCalled()
    expect(prisma.obligationInstance.deleteMany).not.toHaveBeenCalled()
  })

  it('apply (dryRun=false) calls create for every proposed instance', async () => {
    const prisma = fakePrisma({
      client: { findMany: vi.fn().mockResolvedValue([client]) },
      fiscalProfile: { findUnique: vi.fn().mockResolvedValue(COMPANY_PROFILE) },
    })
    const service = new ObligationsService(prisma, fakeClientsService(client))

    const dryRunResult = await service.generate({ asOf: new Date('2026-03-18T00:00:00Z'), clientId: 'c1' }, true)
    await service.generate({ asOf: new Date('2026-03-18T00:00:00Z'), clientId: 'c1' }, false)

    expect(vi.mocked(prisma.obligationInstance.create)).toHaveBeenCalledTimes(dryRunResult.toCreate.length)
  })
})
