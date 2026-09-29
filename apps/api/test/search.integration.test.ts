import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from 'uuidv7'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { getTestPrisma, resetDatabase } from './database.js'
import { createTestApp } from './app.js'
import { authenticate } from './authenticate.js'

const prisma = getTestPrisma()

let app: INestApplication
let cookie: string[]

async function createClient(taxId: string, name: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const client = await prisma.client.create({
    data: { id: uuidv7(), kind: 'COMPANY', name, taxId, accounting: 'ORGANIZED', legalForm: 'LDA', ...overrides },
  })
  return client.id
}

function get(path: string) {
  return request(app.getHttpServer()).get(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq')
}

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

describe('GET /api/v1/search', () => {
  it('finds a client by a three-letter prefix', async () => {
    const clientId = await createClient('501111111', 'Marisa Unipessoal, Lda.')

    const response = await get('/api/v1/search?q=mari')

    expect(response.status).toBe(200)
    expect(response.body).toEqual([
      expect.objectContaining({ type: 'client', id: clientId, label: 'Marisa Unipessoal, Lda.', href: `/clients/${clientId}` }),
    ])
  })

  // Review Focus 5.
  it('folds accents in both directions', async () => {
    await createClient('501222222', 'Padaria Araújo, Lda.')

    expect((await get('/api/v1/search?q=araujo')).body).toHaveLength(1)
    expect((await get('/api/v1/search?q=ARAÚJO')).body).toHaveLength(1)
  })

  it('finds a client by the first digits of its tax number', async () => {
    await createClient('501442634', 'Padaria Central, Lda.')

    expect((await get('/api/v1/search?q=5014')).body).toHaveLength(1)
  })

  // Review Focus 1.
  it('answers an empty list with a 200 when nothing searchable was typed', async () => {
    await createClient('501333333', 'Padaria Central, Lda.')

    for (const q of ['', '!!!', '%26', '%3A']) {
      const response = await get(`/api/v1/search?q=${q}`)
      expect(response.status).toBe(200)
      expect(response.body).toEqual([])
    }
  })

  // Review Focus 2.
  it('finds a client whose own name contains tsquery syntax', async () => {
    const clientId = await createClient('501444444', 'A & B Contabilidade, Lda.')

    const response = await get('/api/v1/search?q=contabilidade')

    expect(response.status).toBe(200)
    expect(response.body[0]?.id).toBe(clientId)
  })

  // Review Focus 3: the assertion that pins design §3.1.
  it('never returns a credential, its label or its ciphertext', async () => {
    const clientId = await createClient('501555555', 'Padaria Central, Lda.')
    const platform = await prisma.platform.create({
      data: { id: uuidv7(), name: 'Portal das Finanças', url: 'https://portaldasfinancas.gov.pt', authKind: 'PASSWORD' },
    })
    const credential = await prisma.credential.create({
      data: { id: uuidv7(), clientId, platformId: platform.id, label: 'gerente' },
    })
    await prisma.credentialVersion.create({
      data: {
        id: uuidv7(),
        credentialId: credential.id,
        ciphertext: Buffer.from('ciphertext-never-searchable'),
        iv: Buffer.from('0123456789ab'),
      },
    })

    const byLabel = await get('/api/v1/search?q=gerente')
    const byCiphertext = await get('/api/v1/search?q=ciphertext')

    expect(byLabel.body).toEqual([])
    expect(byCiphertext.body).toEqual([])
    // The platform itself IS findable — that is the path to the credential.
    const byPlatform = await get('/api/v1/search?q=finan')
    expect(byPlatform.body).toEqual([expect.objectContaining({ type: 'platform', id: platform.id })])
  })

  it('excludes archived clients', async () => {
    await createClient('501666666', 'Arquivada, Lda.', { archivedAt: new Date() })

    expect((await get('/api/v1/search?q=arquivada')).body).toEqual([])
  })

  it('finds an obligation by its definition name, with the client as context', async () => {
    const clientId = await createClient('501777777', 'Padaria Central, Lda.')
    await prisma.obligationDefinition.create({
      data: { code: 'IVA_TRIM', name: 'IVA trimestral', authority: 'TAX', periodicity: 'QUARTERLY', source: 'CATALOG' },
    })
    const instance = await prisma.obligationInstance.create({
      data: {
        id: uuidv7(),
        clientId,
        definitionCode: 'IVA_TRIM',
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-03-31T00:00:00Z'),
        periodLabel: '2026-Q1',
        dueDate: new Date('2026-05-15T00:00:00Z'),
      },
    })

    const response = await get('/api/v1/search?q=trimestral')

    expect(response.body).toEqual([
      expect.objectContaining({
        type: 'obligation',
        id: instance.id,
        context: 'Padaria Central, Lda.',
        href: `/clients/${clientId}`,
      }),
    ])
  })

  it('finds a charge by its description, including a written-off one', async () => {
    const clientId = await createClient('501888888', 'Padaria Central, Lda.')
    const charge = await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'Relatório único',
        amountCents: 9000,
        issuedOn: new Date('2026-01-01T00:00:00Z'),
        dueOn: new Date('2026-01-31T00:00:00Z'),
        writtenOffAt: new Date(),
        writeOffReason: 'Cortesia',
      },
    })

    const response = await get('/api/v1/search?q=relatorio')

    expect(response.body).toEqual([
      expect.objectContaining({ type: 'charge', id: charge.id, context: 'Padaria Central, Lda.' }),
    ])
  })

  it('caps each type at ten hits', async () => {
    for (let index = 0; index < 12; index += 1) {
      await createClient(`5019${String(index).padStart(5, '0')}`, `Padaria Central ${index}, Lda.`)
    }

    const response = await get('/api/v1/search?q=padaria')

    expect(response.body).toHaveLength(10)
  })

  it('ranks a client above a charge that mentions the same word', async () => {
    const clientId = await createClient('502111111', 'Talho Silva, Lda.')
    await prisma.charge.create({
      data: {
        id: uuidv7(),
        clientId,
        kind: 'EXTRA',
        description: 'Trabalho para o Talho',
        amountCents: 9000,
        issuedOn: new Date('2026-01-01T00:00:00Z'),
        dueOn: new Date('2026-01-31T00:00:00Z'),
      },
    })

    const response = await get('/api/v1/search?q=talho')

    expect(response.body[0]?.type).toBe('client')
  })

  it('requires a session', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/search?q=mari')

    expect(response.status).toBe(401)
  })
})
