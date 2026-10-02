import { describe, expect, it } from 'vitest'
import { formatCsvAmount, toCsv } from './toCsv'

describe('toCsv', () => {
  it('leads with a UTF-8 BOM, or Excel renders Araújo as mojibake', () => {
    expect(toCsv(['Nome'], [['Araújo']], 'pt-PT').startsWith('﻿')).toBe(true)
  })

  it('separates with a semicolon under pt-PT', () => {
    expect(toCsv(['A', 'B'], [['1', '2']], 'pt-PT')).toBe('﻿A;B\r\n1;2\r\n')
  })

  it('separates with a comma under en-GB', () => {
    expect(toCsv(['A', 'B'], [['1', '2']], 'en-GB')).toBe('﻿A,B\r\n1,2\r\n')
  })

  it('quotes a field containing the delimiter', () => {
    expect(toCsv(['A'], [['x;y']], 'pt-PT')).toBe('﻿A\r\n"x;y"\r\n')
    // A semicolon is not special under en-GB, so it is not quoted there.
    expect(toCsv(['A'], [['x;y']], 'en-GB')).toBe('﻿A\r\nx;y\r\n')
  })

  it('doubles an internal quote and wraps the field', () => {
    expect(toCsv(['A'], [['say "hi"']], 'pt-PT')).toBe('﻿A\r\n"say ""hi"""\r\n')
  })

  it('quotes a field containing a newline', () => {
    expect(toCsv(['A'], [['one\ntwo']], 'pt-PT')).toBe('﻿A\r\n"one\ntwo"\r\n')
  })

  it('emits a header row and no data rows for an empty report', () => {
    expect(toCsv(['A', 'B'], [], 'pt-PT')).toBe('﻿A;B\r\n')
  })
})

describe('formatCsvAmount', () => {
  // Deliberately not formatCurrency: a euro sign makes the cell text rather
  // than a number, and a grouping separator collides with the delimiter.
  it('writes a plain decimal with the locale separator and no grouping', () => {
    expect(formatCsvAmount(1234567, 'pt-PT')).toBe('12345,67')
    expect(formatCsvAmount(1234567, 'en-GB')).toBe('12345.67')
  })

  it('always writes two decimals', () => {
    expect(formatCsvAmount(9000, 'pt-PT')).toBe('90,00')
    expect(formatCsvAmount(0, 'en-GB')).toBe('0.00')
  })
})
