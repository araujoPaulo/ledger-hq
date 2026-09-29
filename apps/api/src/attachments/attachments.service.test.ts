import { describe, expect, it } from 'vitest'
import { AppError } from '@ledger-hq/domain'
import { assertAcceptable, sniffContentType } from './attachments.service.js'

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])

describe('sniffContentType', () => {
  it.each([
    ['application/pdf', PDF],
    ['image/png', PNG],
    ['image/jpeg', JPEG],
  ])('recognises %s from its leading bytes', (expected, bytes) => {
    expect(sniffContentType(bytes)).toBe(expected)
  })

  it.each([
    ['a zip, which PDFs are often confused with', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
    ['an ELF binary', Buffer.from([0x7f, 0x45, 0x4c, 0x46])],
    ['plain text', Buffer.from('hello, this is not a receipt')],
    ['an empty buffer', Buffer.alloc(0)],
    ['a buffer shorter than any signature', Buffer.from([0x25, 0x50])],
  ])('returns null for %s', (_label, bytes) => {
    expect(sniffContentType(bytes)).toBeNull()
  })
})

describe('assertAcceptable', () => {
  it('returns the sniffed type when the declaration agrees', () => {
    expect(assertAcceptable('application/pdf', PDF)).toBe('application/pdf')
  })

  it('tolerates a charset parameter on the declared type', () => {
    expect(assertAcceptable('application/pdf; charset=binary', PDF)).toBe('application/pdf')
  })

  // The multipart part's Content-Type is chosen by the client. It is a
  // label, not evidence (design §3.4).
  it('rejects a PNG declared as a PDF', () => {
    expect(() => assertAcceptable('application/pdf', PNG)).toThrow(AppError)
    try {
      assertAcceptable('application/pdf', PNG)
    } catch (error) {
      expect((error as AppError).code).toBe('attachments.type_not_allowed')
      expect((error as AppError).status).toBe(415)
    }
  })

  it('rejects a file whose bytes match nothing accepted, however it is labelled', () => {
    try {
      assertAcceptable('application/pdf', Buffer.from('#!/bin/sh\nrm -rf /'))
    } catch (error) {
      expect((error as AppError).code).toBe('attachments.type_not_allowed')
    }
  })

  it('rejects an accepted-looking file declared as an unaccepted type', () => {
    try {
      assertAcceptable('application/zip', PDF)
    } catch (error) {
      expect((error as AppError).code).toBe('attachments.type_not_allowed')
      expect((error as AppError).params).toMatchObject({ contentType: 'application/zip' })
    }
  })
})
