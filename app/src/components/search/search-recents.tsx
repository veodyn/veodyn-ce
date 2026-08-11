'use client'

import Link from 'next/link'
import { History, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/icon-button'
import { searchHref } from '@/lib/search/url'

export function SearchRecents({
  recents,
  onRemove,
  onClear,
}: {
  recents: string[]
  onRemove: (term: string) => void
  onClear: () => void
}) {
  // Before anything has been searched there is nothing to list, so a single
  // hint stands in rather than an empty labelled block.
  if (recents.length === 0) {
    return (
      <p className="px-3 py-6 text-sm text-muted-foreground">
        Search across queries, dashboards, datasets, KPIs and reports.
      </p>
    )
  }

  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between border-b px-3 pb-1.5">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Recent searches
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onClear}
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          Clear
        </Button>
      </div>
      <ul className="flex flex-col">
        {recents.map((term) => (
          <li
            key={term}
            className="group flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-accent/60"
          >
            <History className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Link
              href={searchHref(term, 'all')}
              data-search-row=""
              className="min-w-0 flex-1 truncate text-sm text-foreground focus-visible:underline focus-visible:outline-none"
            >
              {term}
            </Link>
            {/* An X beside a search term could as easily mean "search for the
                opposite" or "close": the tooltip says which list it removes
                from, and the accessible name keeps naming the term itself. */}
            <IconButton
              tooltip="Remove from recent searches"
              aria-label={`Remove ${term} from recent searches`}
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => onRemove(term)}
              className="size-5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </li>
        ))}
      </ul>
    </section>
  )
}
