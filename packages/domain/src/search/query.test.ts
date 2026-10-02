import { describe, expect, it } from 'vitest'
import { toTsQuery } from './query'

describe('toTsQuery', () => {
  it('gives a single term the prefix operator', () => {
    expect(toTsQuery('mari')).toBe('mari:*')
  })

  it('joins several terms with & and prefixes only the last', () => {
    expect(toTsQuery('mari lda')).toBe('mari & lda:*')
  })

  it('keeps digits, so a tax number matches by its first digits', () => {
    expect(toTsQuery('501 234')).toBe('501 & 234:*')
  })

  it('keeps letters outside ASCII, so an accented term survives', () => {
    expect(toTsQuery('araújo')).toBe('araújo:*')
  })

  it('collapses runs of whitespace rather than emitting empty terms', () => {
    expect(toTsQuery('  mari   lda  ')).toBe('mari & lda:*')
  })

  it('returns null for an empty or whitespace-only input', () => {
    expect(toTsQuery('')).toBeNull()
    expect(toTsQuery('   ')).toBeNull()
  })

  it('returns null when nothing searchable survives stripping', () => {
    expect(toTsQuery('!!!')).toBeNull()
    expect(toTsQuery('& | !')).toBeNull()
  })

  // Review Focus 2: these characters are tsquery syntax. They must be
  // stripped from the term, never passed through to the parser.
  it('strips tsquery operators out of a term instead of emitting them', () => {
    expect(toTsQuery('A & B')).toBe('a & b:*')
    expect(toTsQuery('a|b')).toBe('ab:*')
    expect(toTsQuery('a:b')).toBe('ab:*')
    expect(toTsQuery('back\\slash')).toBe('backslash:*')
    expect(toTsQuery('(mari)')).toBe('mari:*')
  })

  // Stripping happens WITHIN a term, so a tax number typed with separators
  // stays one token — which is what the stored vector holds. This is the
  // case that decides the rule: '501.442.634' must find the client whose
  // taxId is '501442634', and splitting on the dots would AND three tokens
  // that appear nowhere.
  it('keeps a separated tax number as one searchable token', () => {
    expect(toTsQuery('501.442.634')).toBe('501442634:*')
  })

  // The same rule has a cost, recorded rather than hidden: Postgres's parser
  // splits "O'Brien" into `o` and `brien` when it builds the vector, while
  // this produces `obrien`, which matches neither. Names with apostrophes are
  // found by their other words. Revisit only if that becomes a real miss.
  it('merges an apostrophised term into one token', () => {
    expect(toTsQuery("o'brien")).toBe('obrien:*')
  })

  it('lowercases, so the query does not depend on how the operator typed it', () => {
    expect(toTsQuery('Marisa')).toBe('marisa:*')
  })

  it('never emits a bare colon-star for a term that stripped to nothing', () => {
    expect(toTsQuery('mari ###')).toBe('mari:*')
  })
})
