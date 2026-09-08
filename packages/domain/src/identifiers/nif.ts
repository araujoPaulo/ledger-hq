/** First digits assigned by the Portuguese tax authority. */
const ASSIGNED_FIRST_DIGITS = new Set(['1', '2', '3', '5', '6', '7', '8', '9'])

/**
 * Validates a Portuguese tax identification number (NIF).
 *
 * Nine digits, where the ninth is a modulo-11 check digit over the first
 * eight weighted 9 down to 2.
 */
export function isValidNif(value: string): boolean {
  const nif = value.trim()

  if (!/^\d{9}$/.test(nif)) return false

  const firstDigit = nif[0]
  if (firstDigit === undefined || !ASSIGNED_FIRST_DIGITS.has(firstDigit)) {
    return false
  }

  let sum = 0
  for (let index = 0; index < 8; index += 1) {
    sum += Number(nif[index]) * (9 - index)
  }

  const remainder = sum % 11
  const checkDigit = remainder < 2 ? 0 : 11 - remainder

  return checkDigit === Number(nif[8])
}
