import { describe, expect, it } from 'vitest'
import { ERROR_CODES } from '../errors'
import {
  ACCEPTED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  attachmentParamsSchema,
  obligationParamsSchema,
} from './attachments'

describe('attachment constants', () => {
  it('accepts exactly the three types the design settled on', () => {
    expect([...ACCEPTED_ATTACHMENT_TYPES]).toEqual(['application/pdf', 'image/png', 'image/jpeg'])
  })

  it('caps an upload at 10 MiB', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024)
  })

  it('registers the three attachment error codes', () => {
    for (const code of ['attachments.type_not_allowed', 'attachments.too_large', 'attachments.file_missing']) {
      expect(ERROR_CODES).toContain(code)
    }
  })
})

describe('attachmentParamsSchema', () => {
  const obligationId = '0199f7b0-0000-7000-8000-000000000001'
  const id = '0199f7b0-0000-7000-8000-000000000002'

  it('accepts two uuids', () => {
    expect(attachmentParamsSchema.safeParse({ obligationId, id }).success).toBe(true)
  })

  // The path is built from these two values and nothing else (design §3.2),
  // so anything that is not a uuid must never reach the storage service.
  it.each(['..', '../../etc/passwd', '', 'not-a-uuid', `${id}/../..`])('rejects %j as an id', (bad) => {
    expect(attachmentParamsSchema.safeParse({ obligationId, id: bad }).success).toBe(false)
    expect(attachmentParamsSchema.safeParse({ obligationId: bad, id }).success).toBe(false)
  })

  it('rejects an unknown extra param', () => {
    expect(attachmentParamsSchema.safeParse({ obligationId, id, extra: 'x' }).success).toBe(false)
  })
})

describe('obligationParamsSchema', () => {
  it('accepts one uuid and rejects a path fragment', () => {
    expect(obligationParamsSchema.safeParse({ obligationId: '0199f7b0-0000-7000-8000-000000000001' }).success).toBe(true)
    expect(obligationParamsSchema.safeParse({ obligationId: '../..' }).success).toBe(false)
  })
})
