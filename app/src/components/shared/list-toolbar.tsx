'use client'

// The search box every list gets. /queries and /dashboards each grew their own,
// while KPIs, Reports, Feed Health, Alerts and Schedules had none at all: fine
// at three rows, a wall at fifty. This is the one both halves now use.

import { useId, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'

interface ListToolbarProps {
  search: string
  onSearchChange: (value: string) => void
  /** Names the field for assistive tech: "Search KPIs", not "Search". */
  searchLabel: string
  placeholder?: string
  /** How many rows survived the filter, announced as it changes. */
  count?: number
  /** Singular noun for the count, pluralized with a trailing s by default. */
  noun?: string
  /** The plural, for nouns a trailing s gets wrong ("query" to "queries"). */
  nounPlural?: string
  /**
   * Scope tabs (All / Mine / Favorites) for the lists that have them.
   *
   * They live in the toolbar rather than a row of their own so that every list
   * page has one control strip in one place. /queries and /dashboards used to
   * put their tabs on the left and their search on the far right with no count,
   * while every other list did the opposite, so moving between two lists meant
   * looking for the same control somewhere else.
   */
  filters?: ReactNode
}

export function ListToolbar({
  search,
  onSearchChange,
  searchLabel,
  placeholder = 'Search...',
  count,
  noun = 'result',
  nounPlural,
  filters,
}: ListToolbarProps) {
  const fieldId = useId()

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {filters}
      <Label htmlFor={fieldId} className="sr-only">
        {searchLabel}
      </Label>
      <InputGroup className="w-64">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          id={fieldId}
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
        />
      </InputGroup>
      {count !== undefined && (
        // Live, because filtering happens as you type and a sighted user sees
        // the table shrink while a screen reader user would otherwise hear
        // nothing at all.
        <p role="status" className="text-sm text-muted-foreground">
          {count} {count === 1 ? noun : (nounPlural ?? `${noun}s`)}
        </p>
      )}
    </div>
  )
}
