'use client'

import { useId, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useQueries, useQueryById } from '@/hooks/use-queries'

interface QueryPickerProps {
  selectedQueryId: number | null
  onSelect: (queryId: number) => void
  onClear: () => void
  error?: string | null
}

/**
 * Modelled on add-widget-search: an InputGroup search box over
 * `useQueries({ search })`, then a scrolling list of ghost buttons.
 *
 * Not a combobox: this repo has no combobox primitive. Once a query is
 * picked, the search and the list disappear behind a one-line summary with a
 * "Change" control, so the rest of the form (mapping, on-failure) is not
 * competing with a long result list for screen space.
 */
export function QueryPicker({ selectedQueryId, onSelect, onClear, error }: QueryPickerProps) {
  const [search, setSearch] = useState('')
  const searchId = useId()
  // Read by id rather than trusting the list to still contain the selection:
  // a narrowed search would otherwise drop the picked query's name from view.
  const { data: selected } = useQueryById(selectedQueryId ?? undefined)
  const { data: page } = useQueries({ search: search || undefined })
  const queries = page?.results ?? []

  if (selectedQueryId != null) {
    return (
      <div className="space-y-1">
        {/* No htmlFor: the search input this would have pointed at is in the
            other branch and is not rendered once a query is picked, so the
            association would dangle. What is below is a name and a button, not
            a field. */}
        <Label>Source query</Label>
        <div className="flex items-center justify-between rounded-lg border border-input px-3 py-2">
          <span className="text-sm font-medium">{selected?.name ?? `query ${selectedQueryId}`}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Change
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={searchId}>Source query</Label>
      <InputGroup>
        <InputGroupAddon>
          <Search className="h-4 w-4" />
        </InputGroupAddon>
        <InputGroupInput
          id={searchId}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search queries by name..."
        />
      </InputGroup>
      {/* ScrollArea rather than a raw `overflow-y-auto`, which rendered the
          platform's own scrollbar: on a dark theme that is a light track and a
          light thumb, drawn over the list and matching nothing else in the app.
          Same primitive the sidebar scroller uses. */}
      <ScrollArea className="max-h-[280px] rounded-lg border border-input">
        <div className="divide-y">
          {queries.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {search ? 'No queries match your search' : 'No queries available'}
            </div>
          )}
          {queries.map((q) => (
            <Button
              key={q.id}
              type="button"
              variant="ghost"
              onClick={() => onSelect(q.id)}
              className="h-auto w-full justify-start rounded-none px-4 py-3 text-left"
            >
              {/* min-w-0 is load-bearing: the button is a flex container and a
                  flex item's min-width defaults to auto, so without it the
                  description sets the item's width from its full unwrapped
                  length and runs under the scrollbar instead of truncating. */}
              <div className="w-full min-w-0">
                <div className="truncate text-sm font-medium">{q.name}</div>
                {q.description && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{q.description}</p>
                )}
              </div>
            </Button>
          ))}
        </div>
      </ScrollArea>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
