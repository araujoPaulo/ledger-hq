import { useQuery } from '@tanstack/react-query'
import { Link, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { SearchX } from 'lucide-react'
import { ErrorMessage } from '../shell/ErrorMessage'
import { Card, DataList, EmptyState, PageHeader } from '../ui'
import { getSearchResults } from './api'
import type { SearchHitType } from './api'
import { SearchResultsSkeleton } from './SearchResultsSkeleton'

// Fixed order, so the groups do not reshuffle as ranks change between
// keystrokes. Matches the server's own typeRank.
const GROUPS: SearchHitType[] = ['client', 'platform', 'obligation', 'charge']

export function SearchResultsPage() {
  const { t } = useTranslation('common')
  const { q } = useSearch({ from: '/search' })

  const results = useQuery({
    queryKey: ['search', q],
    queryFn: () => getSearchResults(q),
    // An empty box is not a search. Without this the page fires a request on
    // every backspace down to zero characters.
    enabled: q.trim().length > 0,
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('search.resultsTitle')} {...(q.trim().length > 0 ? { description: q } : {})} />

      {q.trim().length === 0 ? (
        <p className="text-sm text-muted">{t('search.prompt')}</p>
      ) : results.isPending ? (
        <SearchResultsSkeleton />
      ) : results.isError ? (
        <ErrorMessage error={results.error} />
      ) : results.data.length === 0 ? (
        <EmptyState icon={SearchX} title={t('search.empty')} description={t('search.emptyHint')} />
      ) : (
        GROUPS.filter((group) => results.data.some((hit) => hit.type === group)).map((group) => (
          <section key={group} className="flex flex-col gap-3">
            {/* PageHeader owns the h1; every group is a section of it. */}
            <h2 className="text-lg font-semibold">{t(`search.group.${group}`)}</h2>
            <Card padding="none" className="px-5">
              <DataList>
                {results.data
                  .filter((hit) => hit.type === group)
                  .map((hit) => (
                    <DataList.Row
                      key={`${hit.type}:${hit.id}`}
                      label={
                        <Link to={hit.href} className="font-medium">
                          {hit.label}
                        </Link>
                      }
                      value={hit.context === null ? null : <span className="text-sm text-muted">{hit.context}</span>}
                    />
                  ))}
              </DataList>
            </Card>
          </section>
        ))
      )}
    </div>
  )
}
