/**
 * Validates the shape of a Portuguese social security number (NISS):
 * eleven digits beginning with 1 (natural person) or 2 (legal person).
 *
 * The check digit is deliberately not enforced. Getting that algorithm wrong
 * would reject valid numbers, which is worse than accepting a mistyped one in
 * a single-user system where the owner sees the value on screen.
 */
export function isValidNissFormat(value: string): boolean {
  return /^[12]\d{10}$/.test(value.trim())
}
