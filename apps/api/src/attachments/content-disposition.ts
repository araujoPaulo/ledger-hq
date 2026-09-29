/**
 * Builds an RFC 6266 / RFC 5987 `Content-Disposition` for a filename the
 * operator chose, which is to say an arbitrary string.
 *
 * Two names go out: `filename*` carries the real one, UTF-8 and
 * percent-encoded, which every current browser prefers; `filename` is the
 * ASCII fallback for anything that does not understand `filename*`. The
 * fallback is folded rather than escaped, because a raw control character or
 * a bare quote in a header value is header injection, not a filename.
 */
export function contentDisposition(filename: string): string {
  const fallback = asciiFallback(filename)

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(filename)}`
}

function asciiFallback(filename: string): string {
  // Fold the stem and the extension separately: a name that is entirely
  // non-ASCII (e.g. "日本語.pdf") folds its stem away to nothing, and an
  // extension alone is not a filename — the whole thing falls back to
  // "attachment" rather than surfacing a bare ".pdf".
  const lastDot = filename.lastIndexOf('.')
  const stem = lastDot > 0 ? filename.slice(0, lastDot) : filename
  const extension = lastDot > 0 ? filename.slice(lastDot) : ''

  const foldedStem = fold(stem)

  // A stem that folds away to nothing, or to nothing but dots (a leading-dot
  // name like ".日本語" or "..日本語" folds its non-ASCII remainder away and
  // leaves only the dot(s) that were already there), carries no information.
  // Treat it the same as empty: fall back to "attachment" and drop the
  // extension too, rather than surfacing a bare "." or "..".
  if (/^\.*$/.test(foldedStem)) return 'attachment'

  // An extension that itself folds away to nothing but a dot (e.g.
  // "receipt.日本語") would otherwise leave a dangling trailing dot.
  return `${foldedStem}${fold(extension)}`.replace(/\.$/, '')
}

function fold(value: string): string {
  return value
    // Decompose, then drop the combining marks: "ç" becomes "c" rather than
    // being deleted outright, which keeps a Portuguese filename readable.
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    // Everything outside printable ASCII goes, and so do the two characters
    // that would end the quoted string or split the response.
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '')
    .trim()
}

function encodeRfc5987(value: string): string {
  // encodeURIComponent leaves !'()* alone; RFC 5987's attr-char excludes
  // them, so they are encoded by hand.
  return encodeURIComponent(value).replace(/['()!*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}
