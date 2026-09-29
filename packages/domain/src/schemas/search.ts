import { z } from 'zod'

/**
 * An empty `q` is valid and answers `[]`: the box is emptied on every
 * backspace, and a 422 per keystroke would be noise, not safety. The cap is
 * there so a pasted document never reaches `toTsQuery`.
 */
export const searchQuerySchema = z
  .object({ q: z.string().trim().max(200) })
  .strict()

export type SearchQuery = z.infer<typeof searchQuerySchema>
