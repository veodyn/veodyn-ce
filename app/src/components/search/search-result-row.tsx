'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { Code2, Database, LayoutGrid, type LucideIcon } from 'lucide-react'
import { TimeAgo } from '@/components/shared/time-ago'
import { featureSearchTypes } from '@/features'
import { splitOnMatch } from '@/lib/search/highlight'
import { type CoreSearchSourceType, type SearchResultItem } from '@/services/search/types'

// The same icons the sidebar uses for these sections, so a row reads as its
// type at a glance even in a filtered list with no group header above it.
// Exhaustive over the core CE types only; a registry-contributed type (kpi,
// report, ...) carries its own icon on its FeatureSearchType descriptor,
// merged in below.
export const CORE_SEARCH_TYPE_ICONS: Record<CoreSearchSourceType, LucideIcon> = {
  query: Code2,
  dashboard: LayoutGrid,
  catalog: Database,
}

// Merged once at module load, core types first, so the row below can render
// `<Icon />` from a plain object index rather than a function call: React
// Compiler only recognises a dynamic JSX tag as static when it comes from
// indexing a plain object, not from an arbitrary function's return value.
const ALL_SEARCH_TYPE_ICONS: Record<string, LucideIcon> = {
  ...CORE_SEARCH_TYPE_ICONS,
  ...Object.fromEntries(featureSearchTypes().map((searchType) => [searchType.type, searchType.icon])),
}

/**
 * A type's row icon, whether it is a core CE type or a registry-contributed
 * one. Undefined for a type nothing in this build claims.
 */
export function searchTypeIcon(type: string): LucideIcon | undefined {
  return ALL_SEARCH_TYPE_ICONS[type]
}

export function SearchResultRow({ item, query }: { item: SearchResultItem; query: string }) {
  const Icon = ALL_SEARCH_TYPE_ICONS[item.type]

  return (
    <Link
      href={item.href}
      data-search-row=""
      className="flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
      {/* Inline elements rather than <div>s: this subtree lives inside an <a>. */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">
          {/* Only the matched run is wrapped in an element. Wrapping the
              unmatched runs too would make the accessible name computation
              trim each one, collapsing "Rail Overview" into "RailOverview". */}
          {splitOnMatch(item.title, query).map((segment, i) =>
            segment.matched ? (
              <span key={i} className="font-semibold">
                {segment.text}
              </span>
            ) : (
              <Fragment key={i}>{segment.text}</Fragment>
            )
          )}
        </span>
        {item.subtitle ? (
          <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
        ) : null}
      </span>
      {item.updatedAt ? (
        <TimeAgo
          date={item.updatedAt}
          className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
        />
      ) : null}
    </Link>
  )
}
