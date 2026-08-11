'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { NoData } from '@/components/ui/no-data'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useFederatedSearch } from '@/hooks/use-federated-search'
import { useRecentSearches } from '@/hooks/use-recent-searches'
import { countByType } from '@/lib/search/grouping'
import { searchHref, type SearchTab } from '@/lib/search/url'
import { searchTypeNoun } from '@/services/search/types'
import { SearchInput } from './search-input'
import { SearchRecents } from './search-recents'
import { SearchResultGroups } from './search-result-groups'
import { SearchTypeTabs } from './search-type-tabs'

const DEBOUNCE_MS = 250
const SKELETON_ROWS = 6

function SearchSkeleton() {
  return (
    <div className="flex flex-col" aria-hidden="true">
      {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <div className="h-4 w-4 shrink-0 rounded bg-muted motion-safe:animate-pulse" />
          <div
            className="h-3.5 flex-1 rounded bg-muted motion-safe:animate-pulse"
            style={{ maxWidth: `${60 - i * 6}%` }}
          />
          <div className="h-3 w-10 shrink-0 rounded bg-muted/60 motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  )
}

export function SearchPageClient({
  initialQuery,
  initialTab,
  initialTag = '',
}: {
  initialQuery: string
  initialTab: SearchTab
  /** Set when arriving from a tag chip: /search?tag=rail. */
  initialTag?: string
}) {
  const [value, setValue] = useState(initialQuery)

  // A recent-search link, a tab link, and back/forward are all same-route
  // navigations: the server component re-renders but this shell stays mounted,
  // so a changed initialQuery has to replace what is in the box. Adjusting
  // state during render is React's documented pattern for this; an effect
  // would render one frame of the previous query's results first.
  const [syncedQuery, setSyncedQuery] = useState(initialQuery)
  if (initialQuery !== syncedQuery) {
    setSyncedQuery(initialQuery)
    setValue(initialQuery)
  }

  const debounced = useDebouncedValue(value, DEBOUNCE_MS)
  const trimmed = debounced.trim()

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // A tag on its own is a search ("everything tagged rail"), so the page is
  // active when either the box or the facet has something in it.
  const active = Boolean(trimmed) || Boolean(initialTag)

  const { data, isLoading, isError, refetch } = useFederatedSearch(trimmed, initialTag)
  const { recents, record, remove, clear } = useRecentSearches()

  // Keep the URL in step with the settled query so a result set stays
  // shareable. history.replaceState rather than router.replace: replace would
  // re-run the server component on every debounce for no benefit, and typing
  // must not fill the history stack.
  useEffect(() => {
    window.history.replaceState(null, '', searchHref(trimmed, initialTab, initialTag))
  }, [trimmed, initialTab, initialTag])

  const settled = active && !isLoading && !isError && data !== undefined

  // Only a search that actually came back is worth remembering, and only a
  // typed term: a tag facet is reached from a chip, not recalled by typing.
  useEffect(() => {
    if (settled && trimmed) record(trimmed)
  }, [settled, trimmed, record])

  const results = useMemo(() => data ?? [], [data])
  const counts = useMemo(() => countByType(results), [results])
  const visible = useMemo(
    () => (initialTab === 'all' ? results : results.filter((r) => r.type === initialTab)),
    [results, initialTab]
  )

  // Keyboard navigation moves real DOM focus between rows rather than tracking
  // an index, so Enter activates the link natively and middle-click,
  // right-click, and screen-reader link semantics all stay intact.
  const focusRow = useCallback((delta: number, from: HTMLElement | null) => {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-search-row]') ?? []
    )
    if (rows.length === 0) return
    const next = (from ? rows.indexOf(from) : -1) + delta
    if (next < 0) {
      inputRef.current?.focus()
      return
    }
    rows[Math.min(next, rows.length - 1)]?.focus()
  }, [])

  // The clear button, a recents dismiss, and Clear all each remove the control
  // that was focused. Without this, focus falls back to the document body.
  const focusInput = useCallback(() => inputRef.current?.focus(), [])

  const removeRecent = useCallback(
    (term: string) => {
      remove(term)
      focusInput()
    },
    [remove, focusInput]
  )

  const clearRecents = useCallback(() => {
    clear()
    focusInput()
  }, [clear, focusInput])

  const subject = trimmed ? `"${trimmed}"` : `tag ${initialTag}`
  const announcement = !active
    ? ''
    : isLoading
      ? 'Searching…'
      : isError
        ? 'Search failed.'
        : `${visible.length} ${visible.length === 1 ? 'result' : 'results'} for ${subject}`

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusRow(1, null)
    } else if (e.key === 'Escape') {
      setValue('')
    }
  }

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (!target.matches?.('[data-search-row]')) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusRow(1, target)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusRow(-1, target)
    } else if (e.key === 'Escape') {
      setValue('')
      inputRef.current?.focus()
    }
  }

  return (
    // Search was the only route in the app that centred its column, and the
    // only one with no visible title: arriving here from Settings moved the
    // text block from the left edge to the middle of the window and dropped the
    // heading, so the page read as a different product. It is a list page, so
    // it takes the same full-width shell the other lists use.
    <PageContainer>
      <PageHeader
        title="Search"
        description="Everything in this instance: queries, dashboards, datasets, KPIs, and reports."
      />

      <div className="sticky top-0 z-10 -mx-6 bg-background px-6 pt-3 pb-3">
        <SearchInput
          ref={inputRef}
          value={value}
          onValueChange={setValue}
          onClear={focusInput}
          onKeyDown={onInputKeyDown}
          // Arriving here and typing did nothing: the keystrokes went to
          // <body>. This page is one text field and a list of what it matches,
          // so the field is the page. The file already took focus back on
          // Escape, on clear, and on removing a recent search; the one moment
          // it did not was the one a user meets first.
          autoFocus
        />
        {initialTag && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Tagged</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {initialTag}
            </span>
            {/* A filter you cannot see is a filter you cannot remove. */}
            <Link
              href={searchHref(trimmed, initialTab)}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Clear tag
            </Link>
          </div>
        )}
        <div className="mt-3">
          <SearchTypeTabs
            query={trimmed}
            activeTab={initialTab}
            counts={settled ? counts : undefined}
            total={settled ? results.length : undefined}
            tag={initialTag || undefined}
          />
        </div>
      </div>

      {/* One persistent live region. Announcing from inside the branches below
          would mean the node is replaced rather than updated, and a screen
          reader announces nothing when a search settles or fails. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div ref={listRef} onKeyDown={onListKeyDown} className="mt-4">
        {!active ? (
          <SearchRecents recents={recents} onRemove={removeRecent} onClear={clearRecents} />
        ) : isLoading ? (
          <SearchSkeleton />
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 p-8">
            <p className="text-sm text-destructive">Search failed. Try again.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <NoData
            message={
              initialTab === 'all'
                ? `No results for ${subject}.`
                : `No ${searchTypeNoun(initialTab) ?? initialTab} match ${subject}.`
            }
          />
        ) : (
          <SearchResultGroups
            results={visible}
            query={trimmed}
            activeTab={initialTab}
            tag={initialTag || undefined}
          />
        )}
      </div>
    </PageContainer>
  )
}
