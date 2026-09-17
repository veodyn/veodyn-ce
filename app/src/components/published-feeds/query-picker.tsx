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
  sourceIsNotAQuery?: boolean
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
export function QueryPicker({
  selectedQueryId,
  onSelect,
  onClear,
  error,
  sourceIsNotAQuery,
}: QueryPickerProps) {
  const [search, setSearch] = useState('')
  const groupLabelId = useId()
  const { data: selected } = useQueryById(selectedQueryId ?? undefined)
  const { data: page } = useQueries({ search: search || undefined })
  const queries = page?.results ?? []

  if (selectedQueryId != null) {
    return (
      <div className="space-y-1">
        <Label id={groupLabelId} required>Source query</Label>
        <div
          role="group"
          aria-labelledby={groupLabelId}
          className="flex items-center justify-between rounded-lg border border-input px-3 py-2"
        >
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
      <Label id={groupLabelId} required>
        Source query
      </Label>
      {sourceIsNotAQuery && (
        <p className="text-sm text-muted-foreground">
          This feed has no query behind it: whatever registered its producer rebuilds it. Picking a query
          here binds it to that query, and it publishes from the query from then on.
        </p>
      )}
      <div role="group" aria-labelledby={groupLabelId} className="space-y-2">
        <InputGroup>
          <InputGroupAddon>
            <Search className="h-4 w-4" />
          </InputGroupAddon>
          <InputGroupInput
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search queries by name..."
            aria-label="Search queries by name"
          />
        </InputGroup>
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
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
