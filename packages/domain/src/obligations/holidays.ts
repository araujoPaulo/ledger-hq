const FIXED_HOLIDAYS: ReadonlyArray<readonly [month: number, day: number]> = [
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

/**
 * The anonymous Gregorian algorithm (Meeus/Jones/Butcher) for the date of
 * Easter Sunday. Returns a UTC-midnight `Date`. Verified against the known
 * 2026 date (5 April) in this module's own test file.
 */
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1

  return new Date(Date.UTC(year, month - 1, day))
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime())
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

/** Good Friday and Corpus Christi, the two Easter-derived national holidays this calendar observes. */
function movableHolidays(year: number): Date[] {
  const easter = easterSunday(year)
  return [addDays(easter, -2), addDays(easter, 60)]
}

/**
 * National holidays only — municipal holidays (Santo António, São João, ...)
 * are deliberately excluded, per the master spec (section 7.2): tax
 * deadlines are national.
 */
export function isPublicHoliday(date: Date): boolean {
  const year = date.getUTCFullYear()

  for (const [month, day] of FIXED_HOLIDAYS) {
    if (date.getUTCMonth() + 1 === month && date.getUTCDate() === day) return true
  }

  return movableHolidays(year).some((holiday) => sameCalendarDay(holiday, date))
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

/** Shifts forward one day at a time until landing on a weekday that is not a holiday. */
export function nextBusinessDay(date: Date): Date {
  let candidate = date
  while (isWeekend(candidate) || isPublicHoliday(candidate)) {
    candidate = addDays(candidate, 1)
  }
  return candidate
}
