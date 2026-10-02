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

  describe('formula injection guard', () => {
    // Excel and LibreOffice read a cell as a formula, not text, from its
    // first character alone — one per dangerous leading character.
    it('guards a leading =', () => {
      expect(toCsv(['A'], [['=SUM(A1:A2)']], 'pt-PT')).toBe('﻿A\r\n\'=SUM(A1:A2)\r\n')
    })

    it('guards a leading +', () => {
      expect(toCsv(['A'], [['+351912345678']], 'pt-PT')).toBe('﻿A\r\n\'+351912345678\r\n')
    })

    it('guards a leading -', () => {
      expect(toCsv(['A'], [['-trigger']], 'pt-PT')).toBe('﻿A\r\n\'-trigger\r\n')
    })

    it('guards a leading @', () => {
      expect(toCsv(['A'], [['@SUM(1,1)']], 'pt-PT')).toBe('﻿A\r\n\'@SUM(1,1)\r\n')
    })

    it('guards a leading tab', () => {
      expect(toCsv(['A'], [['\tdata']], 'pt-PT')).toBe('﻿A\r\n\'\tdata\r\n')
    })

    it('guards a leading carriage return, which is also still quote-triggering', () => {
      expect(toCsv(['A'], [['\rdata']], 'pt-PT')).toBe('﻿A\r\n"\'\rdata"\r\n')
    })

    // The one that matters: an over-eager guard would mangle every date and
    // every description that happens to contain a dash.
    it('leaves a value that merely contains = or - partway through untouched', () => {
      expect(toCsv(['A'], [['2026-01-08']], 'pt-PT')).toBe('﻿A\r\n2026-01-08\r\n')
      expect(toCsv(['A'], [['Total = 100']], 'pt-PT')).toBe('﻿A\r\nTotal = 100\r\n')
    })
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
