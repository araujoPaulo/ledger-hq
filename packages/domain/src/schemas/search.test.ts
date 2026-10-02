import { describe, expect, it } from 'vitest'
import { searchQuerySchema } from './search'

describe('searchQuerySchema', () => {
  it('trims the query', () => {
    expect(searchQuerySchema.parse({ q: '  mari  ' })).toEqual({ q: 'mari' })
  })

  it('accepts an empty query — an emptied box is not a validation failure', () => {
    expect(searchQuerySchema.parse({ q: '' })).toEqual({ q: '' })
  })

  it('rejects a query longer than 200 characters', () => {
    expect(searchQuerySchema.safeParse({ q: 'a'.repeat(201) }).success).toBe(false)
  })

  it('rejects unknown keys', () => {
    expect(searchQuerySchema.safeParse({ q: 'mari', limit: 5 }).success).toBe(false)
  })
})
