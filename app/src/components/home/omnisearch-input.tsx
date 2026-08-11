'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

/** Shared with the command palette (Task 8) so both surfaces show identical copy. */
export const SEARCH_PLACEHOLDER = 'Search queries, dashboards, datasets…'

export interface OmnisearchInputProps {
  /**
   * Plan 03 seam. Search federation, the omnisearch results page, and the
   * command palette consume the submitted query later; this shell only surfaces
   * it and does not federate.
   */
  onSubmit?: (query: string) => void
  placeholder?: string
}

export function OmnisearchInput({
  onSubmit,
  placeholder = SEARCH_PLACEHOLDER,
}: OmnisearchInputProps) {
  const [value, setValue] = useState('')
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.(value)
      }}
      className="relative w-full max-w-2xl"
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label="Omnisearch"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-11 pl-9"
      />
    </form>
  )
}
