/**
 * The recovery code's shape is the vault's: `generateRecoveryCode` in
 * `@ledger-hq/crypto` emits 26 base32 characters in hyphenated groups of
 * five, and `recover.ts` derives keys from that exact string. Anything a
 * person types — lower case, spaces, no hyphens — is normalised to it here,
 * so a right code typed loosely is never rejected as wrong.
 */
export const RECOVERY_CODE_LENGTH = 26

const NOT_BASE32 = /[^A-Z2-7]/g

function significantCharacters(text: string): string {
  return text.toUpperCase().replace(NOT_BASE32, '')
}

/** Upper-cases, keeps only base32 characters, and groups them in fives with hyphens. */
export function formatRecoveryCode(text: string): string {
  const code = significantCharacters(text).slice(0, RECOVERY_CODE_LENGTH)
  return (code.match(/.{1,5}/g) ?? []).join('-')
}

/** How many code characters precede `caret` in the raw, unformatted `text`. */
export function significantBefore(text: string, caret: number): number {
  return significantCharacters(text.slice(0, caret)).length
}

/** The caret index in `formatted` just after its `significant`-th code character. */
export function caretInFormatted(formatted: string, significant: number): number {
  if (significant <= 0) return 0

  let seen = 0
  for (let index = 0; index < formatted.length; index += 1) {
    if (formatted[index] !== '-') seen += 1
    if (seen === significant) return index + 1
  }

  return formatted.length
}
