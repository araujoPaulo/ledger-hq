/** The client page's tabs, in strip order. */
export const CLIENT_TABS = ['overview', 'obligations', 'billing', 'people', 'credentials'] as const

export type ClientTab = (typeof CLIENT_TABS)[number]

export function isClientTab(value: unknown): value is ClientTab {
  return typeof value === 'string' && (CLIENT_TABS as readonly string[]).includes(value)
}

/**
 * The client route's search params: an optional `tab`, where absent or
 * unknown means Overview. Optional rather than defaulted, because a required
 * key would make every typed `Link` to a client pass `search` — and most do
 * not care which tab opens.
 */
export function validateClientSearch(search: Record<string, unknown>): { tab?: ClientTab } {
  return isClientTab(search.tab) ? { tab: search.tab } : {}
}
