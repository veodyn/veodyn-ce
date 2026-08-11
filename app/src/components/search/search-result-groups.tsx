'use client'

import Link from 'next/link'
import { groupResults } from '@/lib/search/grouping'
import { searchHref, type SearchTab } from '@/lib/search/url'
import { searchTypeLabel, type SearchResultItem } from '@/services/search/types'
import { SearchResultRow } from './search-result-row'

export function SearchResultGroups({
  results,
  query,
  activeTab,
  tag,
}: {
  /** Already filtered to activeTab by the caller. */
  results: SearchResultItem[]
  query: string
  activeTab: SearchTab
  /** Carried into "Show all", for the same reason the tabs carry it. */
  tag?: string
}) {
  // A type tab is a single type already, so headings and caps would be noise.
  if (activeTab !== 'all') {
    return (
      <ul className="flex flex-col">
        {results.map((item) => (
          <li key={item.id}>
            <SearchResultRow item={item} query={query} />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {groupResults(results).map((group) => (
        <section key={group.type}>
          <div className="mb-1 border-b px-3 pb-1.5">
            <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {searchTypeLabel(group.type) ?? group.type}
              <span className="ml-2 font-mono tabular-nums normal-case">{group.total}</span>
            </h2>
          </div>
          <ul className="flex flex-col">
            {group.items.map((item) => (
              <li key={item.id}>
                <SearchResultRow item={item} query={query} />
              </li>
            ))}
          </ul>
          {/* Below the rows, not beside the heading: it continues the list it
              expands rather than labelling the group. */}
          {group.truncated ? (
            <div className="flex justify-end px-3 pt-1.5">
              <Link
                href={searchHref(query, group.type, tag)}
                className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Show all {group.total}
              </Link>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  )
}
