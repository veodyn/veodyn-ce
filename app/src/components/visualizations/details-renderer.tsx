'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@/components/shared/icon-button'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'

interface DetailsRendererProps {
  visualization: MockVisualization
  data: QueryResultData
}

export function DetailsRenderer({ visualization, data }: DetailsRendererProps) {
  const [rowIndex, setRowIndex] = useState(0)
  // The paging position belongs to the result it was chosen in. Re-running a
  // query that returned four rows into one that returns two used to leave the
  // index past the end, and the renderer claimed "No data to display." for a
  // result that plainly had data. Adjusted during render, which is React's own
  // pattern for state that has to follow a prop: an effect would commit and
  // paint the stale row first and correct it in a second pass, and this
  // project's react-hooks/set-state-in-effect rule rejects that write anyway.
  const [pagedRows, setPagedRows] = useState(data.rows)
  const isNewResult = pagedRows !== data.rows
  if (isNewResult) {
    setPagedRows(data.rows)
    setRowIndex(0)
  }
  // Read through the reset rather than off state, so THIS render already draws
  // the first row of the new result instead of relying on React discarding it.
  const currentIndex = isNewResult ? 0 : rowIndex

  const options = visualization.options as Record<string, unknown>
  const visibleColumns = (options.columns as string[]) || []

  const row = data.rows[currentIndex]
  if (!row) {
    return (
      <div className="p-4 text-sm text-muted-foreground">No data to display.</div>
    )
  }

  const columns = visibleColumns.length > 0
    ? data.columns.filter((c) => visibleColumns.includes(c.name))
    : data.columns

  return (
    <div className="p-4">
      {data.rows.length > 1 && (
        <div className="flex items-center gap-2 mb-4">
          <IconButton
            tooltip="Previous row"
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={currentIndex === 0}
            onClick={() => setRowIndex(currentIndex - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <span className="text-sm text-muted-foreground">
            Row {currentIndex + 1} of {data.rows.length}
          </span>
          <IconButton
            tooltip="Next row"
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={currentIndex >= data.rows.length - 1}
            onClick={() => setRowIndex(currentIndex + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </IconButton>
        </div>
      )}
      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        {columns.map((col) => (
          <div key={col.name} className="contents">
            <dt className="text-sm font-medium text-muted-foreground py-1">{col.friendly_name}</dt>
            <dd className="text-sm py-1 break-all">
              {row[col.name] != null ? String(row[col.name]) : <span className="text-muted-foreground italic">null</span>}
            </dd>
          </div>
        ))}
      </div>
    </div>
  )
}
