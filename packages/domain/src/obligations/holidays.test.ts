import { describe, expect, it } from 'vitest'
import { isPublicHoliday, isWeekend, nextBusinessDay } from './holidays'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

describe('isPublicHoliday', () => {
  it('recognises every fixed national holiday', () => {
    const fixed: Array<[number, number]> = [
      [1, 1], // Ano Novo
      [4, 25], // Dia da Liberdade
      [5, 1], // Dia do Trabalhador
      [6, 10], // Dia de Portugal
      [8, 15], // Assunção de Nossa Senhora
      [10, 5], // Implantação da República
      [11, 1], // Todos os Santos
      [12, 1], // Restauração da Independência
      [12, 8], // Imaculada Conceição
      [12, 25], // Natal
    ]

    for (const [month, day] of fixed) {
      expect(isPublicHoliday(utc(2026, month, day))).toBe(true)
    }
  })

  it('recognises Good Friday and Corpus Christi for a known Easter year', () => {
    // Easter Sunday 2026 is 5 April 2026 (verified via the anonymous
    // Gregorian computus algorithm, independently of this module).
    expect(isPublicHoliday(utc(2026, 4, 3))).toBe(true) // Good Friday = Easter - 2 days
    expect(isPublicHoliday(utc(2026, 6, 4))).toBe(true) // Corpus Christi = Easter + 60 days
  })

  it('does not treat an ordinary day as a holiday', () => {
    expect(isPublicHoliday(utc(2026, 3, 17))).toBe(false)
  })

  it('does not treat a municipal holiday as national', () => {
    // Deliberately excluded per the master spec (section 7.2): tax deadlines
    // are national, municipal holidays are not observed by this calendar.
    // 13 June (Santo António) is a Lisbon municipal holiday, not national.
    expect(isPublicHoliday(utc(2026, 6, 13))).toBe(false)
  })
})

describe('isWeekend', () => {
  it('recognises Saturday and Sunday', () => {
    expect(isWeekend(utc(2026, 3, 21))).toBe(true) // Saturday
    expect(isWeekend(utc(2026, 3, 22))).toBe(true) // Sunday
  })

  it('does not treat a weekday as a weekend', () => {
    expect(isWeekend(utc(2026, 3, 18))).toBe(false) // Wednesday
  })
})

describe('nextBusinessDay', () => {
  it('leaves a weekday that is not a holiday unchanged', () => {
    const day = utc(2026, 3, 18)
    expect(nextBusinessDay(day)).toEqual(day)
  })

  it('shifts a Saturday forward to Monday', () => {
    expect(nextBusinessDay(utc(2026, 3, 21))).toEqual(utc(2026, 3, 23))
  })

  it('shifts a Sunday forward to Monday', () => {
    expect(nextBusinessDay(utc(2026, 3, 22))).toEqual(utc(2026, 3, 23))
  })

  it('shifts a holiday forward, skipping a weekend it lands next to', () => {
    // 25 April 2026 is a Saturday; the holiday and the weekend chain shift
    // together to Monday 27 April.
    expect(nextBusinessDay(utc(2026, 4, 25))).toEqual(utc(2026, 4, 27))
  })

  it('shifts across consecutive holidays', () => {
    // 1 November 2026 (Todos os Santos) is a Sunday; next business day is
    // Monday 2 November, an ordinary day.
    expect(nextBusinessDay(utc(2026, 11, 1))).toEqual(utc(2026, 11, 2))
  })
})
