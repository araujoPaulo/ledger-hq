import { apiFetch } from '../api/client'

export type SearchHitType = 'client' | 'platform' | 'obligation' | 'charge'

export type SearchHit = {
  type: SearchHitType
  id: string
  label: string
  /** The owning client, for a hit that only makes sense underneath one. */
  context: string | null
  href: string
  rank: number
}

export function getSearchResults(q: string): Promise<SearchHit[]> {
  return apiFetch(`/search?q=${encodeURIComponent(q)}`)
}
