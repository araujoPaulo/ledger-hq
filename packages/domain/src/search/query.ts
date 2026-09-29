/**
 * Builds a `to_tsquery` string from what the operator typed.
 *
 * `plainto_tsquery` has no prefix operator and `websearch_to_tsquery` does
 * not expose one, so the query is assembled here: split on whitespace, strip
 * each term of everything outside letters and digits, join the survivors
 * with `&`, and give the last one `:*` so three letters find the client
 * (design §3.4).
 *
 * Stripping is what keeps `tsquery` syntax out of the parser: `&`, `|`, `!`,
 * `:`, `(`, `'` and `\` are operators there, and a client genuinely named
 * "A & B, Lda." must be searchable without any of them reaching Postgres.
 *
 * Returns `null` when nothing searchable survives — an operator holding down
 * backspace is not a validation failure, and the caller answers with an
 * empty list rather than an error.
 */
export function toTsQuery(input: string): string | null {
  const terms = input
    .split(/\s+/)
    // `\p{L}` and `\p{N}` keep accented letters and digits; everything else
    // goes, including every tsquery operator.
    .map((term) => term.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase())
    .filter((term) => term.length > 0)

  if (terms.length === 0) return null

  return terms.map((term, index) => (index === terms.length - 1 ? `${term}:*` : term)).join(' & ')
}
