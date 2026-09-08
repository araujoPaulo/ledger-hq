import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from 'uuidv7'
import { getTestPrisma, resetDatabase } from './database.js'

const prisma = getTestPrisma()

async function createCompany(taxId: string): Promise<string> {
  const id = uuidv7()
  await prisma.client.create({
    data: { id, kind: 'COMPANY', name: 'Padaria Central, Lda.', taxId, accounting: 'ORGANIZED', legalForm: 'LDA' },
  })
  return id
}

async function createIndividual(taxId: string): Promise<string> {
  const id = uuidv7()
  await prisma.client.create({
    data: { id, kind: 'INDIVIDUAL', name: 'Maria Santos', taxId, accounting: 'SIMPLIFIED' },
  })
  return id
}

function employment(employerId: string, employeeId: string, startedOn: string, endedOn?: string) {
  return {
    id: uuidv7(),
    employerId,
    employerKind: 'COMPANY' as const,
    employeeId,
    employeeKind: 'INDIVIDUAL' as const,
    startedOn: new Date(`${startedOn}T00:00:00Z`),
    endedOn: endedOn === undefined ? null : new Date(`${endedOn}T00:00:00Z`),
  }
}

beforeEach(resetDatabase)

describe('client kind constraints', () => {
  it('rejects a company without a legal form', async () => {
    await expect(
      prisma.client.create({
        data: { id: uuidv7(), kind: 'COMPANY', name: 'X', taxId: '501442600', accounting: 'ORGANIZED' },
      }),
    ).rejects.toThrow(/client_kind_fields/)
  })

  it('rejects a legal form on an individual', async () => {
    await expect(
      prisma.client.create({
        data: {
          id: uuidv7(),
          kind: 'INDIVIDUAL',
          name: 'Y',
          taxId: '123456789',
          accounting: 'SIMPLIFIED',
          legalForm: 'LDA',
        },
      }),
    ).rejects.toThrow(/client_kind_fields/)
  })

  it('rejects a social security number on a company', async () => {
    await expect(
      prisma.client.create({
        data: {
          id: uuidv7(),
          kind: 'COMPANY',
          name: 'Z',
          taxId: '501442600',
          accounting: 'ORGANIZED',
          legalForm: 'LDA',
          socialSecurityNo: '21234567890',
        },
      }),
    ).rejects.toThrow(/client_kind_fields/)
  })
})

describe('employment constraints', () => {
  it('accepts an open-ended spell between a company and a person', async () => {
    const employerId = await createCompany('501442600')
    const employeeId = await createIndividual('123456789')

    const created = await prisma.employment.create({ data: employment(employerId, employeeId, '2024-01-15') })

    expect(created.endedOn).toBeNull()
  })

  it('rejects a person as the employer', async () => {
    const personA = await createIndividual('123456789')
    const personB = await createIndividual('999999990')

    await expect(
      prisma.employment.create({
        data: { ...employment(personA, personB, '2024-01-15'), employerKind: 'INDIVIDUAL' },
      }),
    ).rejects.toThrow(/employment_employer_is_company/)
  })

  it('rejects overlapping spells for the same pair', async () => {
    const employerId = await createCompany('501442600')
    const employeeId = await createIndividual('123456789')

    await prisma.employment.create({ data: employment(employerId, employeeId, '2024-01-01', '2024-12-31') })

    await expect(
      prisma.employment.create({ data: employment(employerId, employeeId, '2024-06-01', '2025-01-31') }),
    ).rejects.toThrow(/employment_no_overlap/)
  })

  it('accepts consecutive spells for the same pair', async () => {
    const employerId = await createCompany('501442600')
    const employeeId = await createIndividual('123456789')

    await prisma.employment.create({ data: employment(employerId, employeeId, '2024-01-01', '2024-12-31') })
    const second = await prisma.employment.create({ data: employment(employerId, employeeId, '2025-01-01') })

    expect(second.startedOn).toEqual(new Date('2025-01-01T00:00:00Z'))
  })

  it('accepts concurrent spells with two different employers', async () => {
    const firstEmployer = await createCompany('501442600')
    const secondEmployer = await createCompany('999999990')
    const employeeId = await createIndividual('123456789')

    await prisma.employment.create({ data: employment(firstEmployer, employeeId, '2024-01-01') })

    await expect(
      prisma.employment.create({ data: employment(secondEmployer, employeeId, '2024-06-01') }),
    ).resolves.toBeDefined()
  })

  it('rejects an end date before the start date', async () => {
    const employerId = await createCompany('501442600')
    const employeeId = await createIndividual('123456789')

    await expect(
      prisma.employment.create({ data: employment(employerId, employeeId, '2024-06-01', '2024-01-01') }),
    ).rejects.toThrow(/employment_ended_after_started/)
  })
})
