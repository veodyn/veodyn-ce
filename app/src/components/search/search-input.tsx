'use client'

import type { KeyboardEventHandler, Ref } from 'react'
import { Search, X } from 'lucide-react'
import { IconButton } from '@/components/shared/icon-button'
import { Input } from '@/components/ui/input'

export const SEARCH_PAGE_PLACEHOLDER = 'Search queries, dashboards, datasets, KPIs, reports…'

export function SearchInput({
  value,
  onValueChange,
  onClear,
  onKeyDown,
  autoFocus,
  ref,
}: {
  value: string
  onValueChange: (next: string) => void
  /** Runs after clearing, so the caller can take back the vanishing focus. */
  onClear?: () => void
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>
  // A prop rather than always-on, because "focus me on mount" is a claim about
  // the PAGE, not about this control. It is right on /search, whose entire
  // body is this field, and wrong anywhere the box is one control among many.
  autoFocus?: boolean
  // React 19 passes ref as an ordinary prop, so no forwardRef wrapper.
  ref?: Ref<HTMLInputElement>
}) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={ref}
        type="search"
        aria-label="Search"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        placeholder={SEARCH_PAGE_PLACEHOLDER}
        // The native search cancel button is suppressed in favour of the
        // themed clear button below, so there are not two of them.
        className="h-12 pr-10 pl-9 text-base [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value ? (
        <IconButton
          tooltip="Clear search"
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            onValueChange('')
            onClear?.()
          }}
          className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </IconButton>
      ) : null}
    </div>
  )
}
