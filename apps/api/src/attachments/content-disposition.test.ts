import { describe, expect, it } from 'vitest'
import { contentDisposition } from './content-disposition.js'

describe('contentDisposition', () => {
  it('is always an attachment, never inline', () => {
    // Inline would hand a hostile PDF to the browser's own renderer in an
    // origin holding an unlocked vault session (design §3.8).
    expect(contentDisposition('receipt.pdf')).toMatch(/^attachment;/)
  })

  it('carries a plain ASCII name as-is', () => {
    expect(contentDisposition('receipt.pdf')).toBe(`attachment; filename="receipt.pdf"; filename*=UTF-8''receipt.pdf`)
  })

  it('keeps a non-ASCII name intact in filename* and folds it for the fallback', () => {
    const header = contentDisposition('Declaração periódica — 2026Q1.pdf')

    expect(header).toContain(`filename*=UTF-8''Declara%C3%A7%C3%A3o%20peri%C3%B3dica%20%E2%80%94%202026Q1.pdf`)
    // The fallback must be ASCII-only: a raw non-ASCII byte in a header
    // value is what makes a client drop the header entirely.
    const fallback = /filename="([^"]*)"/.exec(header)?.[1] ?? ''
    expect(fallback).toBe('Declaracao periodica  2026Q1.pdf')
    // eslint-disable-next-line no-control-regex -- asserting the absence of control and high bytes is the point
    expect(fallback).not.toMatch(/[^\x20-\x7e]/)
  })

  it('strips a quote, a backslash and a newline rather than emitting them', () => {
    // A bare " ends the quoted string early and a CR/LF splits the response
    // into two — header injection, from a filename the operator typed.
    const header = contentDisposition('a"b\\c\r\nd.pdf')

    expect(header).not.toContain('\r')
    expect(header).not.toContain('\n')
    const fallback = /filename="([^"]*)"/.exec(header)?.[1] ?? ''
    expect(fallback).toBe('abcd.pdf')
  })

  it('never emits an empty fallback, however little survives folding', () => {
    const fallback = /filename="([^"]*)"/.exec(contentDisposition('日本語.pdf'))?.[1] ?? ''

    expect(fallback).toBe('attachment')
  })

  it('falls back to attachment for a leading-dot name that folds to a bare dot', () => {
    const fallback = /filename="([^"]*)"/.exec(contentDisposition('.日本語'))?.[1] ?? ''

    expect(fallback).toBe('attachment')
  })

  it('falls back to attachment for a name that folds to nothing but dots', () => {
    const fallback = /filename="([^"]*)"/.exec(contentDisposition('..日本語'))?.[1] ?? ''

    expect(fallback).toBe('attachment')
  })

  it('drops a dangling trailing dot left by an extension that folds away', () => {
    const fallback = /filename="([^"]*)"/.exec(contentDisposition('receipt.日本語'))?.[1] ?? ''

    expect(fallback).toBe('receipt')
  })

  it('percent-encodes a quote and a space in filename* too', () => {
    expect(contentDisposition('a b".pdf')).toContain(`filename*=UTF-8''a%20b%22.pdf`)
  })
})
