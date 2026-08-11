'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { SearchTypeCounts } from '@/lib/search/grouping'
import { SEARCH_TABS, searchHref, type SearchTab } from '@/lib/search/url'
import { searchTypeLabel } from '@/services/search/types'

export function SearchTypeTabs({
  query,
  activeTab,
  counts,
  total,
  tag,
  tabs = SEARCH_TABS,
}: {
  query: string
  activeTab: SearchTab
  /**
   * Which tabs to draw, defaulting to this build's own list. Stated by a test
   * that needs the bar for a named registry rather than for whichever packages
   * the tree it runs in installs, the same reason `searchTabs` takes the
   * contributed types as a parameter. No caller in the app passes it.
   */
  tabs?: SearchTab[]
  /**
   * Carried into every tab link. Without it, switching type from a tag search
   * drops the facet, and with no search term the page then has nothing to
   * search for and falls back to recents.
   */
  tag?: string
  /** Both omitted until the search settles, so a stale count is never shown. */
  counts?: SearchTypeCounts
  total?: number
}) {
  return (
    <nav aria-label="Filter results by type" className="flex flex-wrap items-center gap-1">
      {tabs.map((tab) => {
        const active = tab === activeTab
        const count = tab === 'all' ? total : counts?.[tab]

        return (
          <Link
            key={tab}
            href={searchHref(query, tab, tag)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-full px-3 py-1 text-sm transition-colors',
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            {tab === 'all' ? 'All' : (searchTypeLabel(tab) ?? tab)}
            {/* An explicit space so the accessible name reads "Queries 12"
                rather than "Queries12"; the margin below is visual only. */}
            {count !== undefined ? (
              <>
                {' '}
                <span className="ml-0.5 font-mono text-xs tabular-nums opacity-70">{count}</span>
              </>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
