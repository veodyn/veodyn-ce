'use client'

// The SQL behind a query the AI wrote, readable before anyone presses Create.
//
// Behind a disclosure rather than on the face of the card: several statements
// laid out in full is a wall nobody reads, and the point is that the SQL CAN be
// read, not that it must be. Closed by default, one at a time.
//
// Shared by the three cards that can carry a written query (dashboard panels, a
// KPI's source, a report section) so the thing an analyst is being asked to
// approve does not look different depending on which flow they came in through.
import type { NewQueryProposal } from '@/types/ai-create'

interface WrittenQueryDisclosureProps {
  newQuery: NewQueryProposal
  /** Names the specific query for a screen reader when several are on screen. */
  label?: string
}

export function WrittenQueryDisclosure({ newQuery, label }: WrittenQueryDisclosureProps) {
  return (
    <details className="group mt-0.5">
      <summary
        aria-label={label == null ? undefined : `Show SQL for ${label}`}
        className="cursor-pointer truncate text-xs text-muted-foreground hover:text-foreground"
      >
        {newQuery.datasetTable} · show SQL
      </summary>
      <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap">
        {newQuery.sql}
      </pre>
    </details>
  )
}
