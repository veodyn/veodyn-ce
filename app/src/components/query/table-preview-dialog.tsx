'use client'

// What the eye button in the schema browser opens: the first few rows of a
// table, so an analyst can see the shape of the data before writing SQL.
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { readQueryError } from '@/lib/query-error'
import { useTablePreview, tablePreviewSql, TABLE_PREVIEW_ROWS } from '@/hooks/use-table-preview'
import type { QueryResultData, SchemaTable } from '@/lib/mock-data'

/**
 * The table AND the data source it was clicked in, captured together: a source
 * that changes under an open dialog would otherwise run the old table's name
 * against the new connection.
 */
export interface PreviewTarget {
  table: SchemaTable
  dataSourceId: number
}

interface TablePreviewDialogProps {
  target: PreviewTarget | null
  onClose: () => void
}

export function TablePreviewDialog({ target, onClose }: TablePreviewDialogProps) {
  // The dialog is mounted for whichever table was clicked, so the hook is
  // keyed by that table and only runs while one is open.
  const { data, error, isFetching } = useTablePreview({
    dataSourceId: target?.dataSourceId ?? 0,
    table: target?.table.name ?? '',
    columns: target?.table.columns ?? [],
    enabled: target != null,
  })
  const failure = error != null ? readQueryError(error) : null
  const showTable = !isFetching && failure == null && data != null

  return (
    <Dialog open={target != null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 sm:max-w-4xl max-h-[80vh]">
        <DialogHeader className="flex-row items-baseline gap-2 border-b p-4 pr-12">
          <DialogTitle className="shrink-0">Table preview</DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">
            {target?.table.name}
          </DialogDescription>
        </DialogHeader>

        {/* overflow-auto only when NOT holding the table. Table wraps itself in
            an overflow-x-auto div, and per the CSS overflow spec that div
            computes overflow-y as auto too, so it becomes the sticky header's
            scroll container while the ancestor is the one that really scrolls.
            A flex row with min-h-0 makes Table's own wrapper the single real
            scroll container for both axes, the same fix as
            query-result-table.tsx's results grid. The loading and error
            branches hold no Table, so plain overflow-auto is right for them.

            min-w-0 on this row and its child is what lets that overflow-x
            actually scroll: a flex item defaults to min-width:auto and refuses
            to shrink below its content. Found on stage against a 17-column
            ClickHouse table rendering 2589px inside an 896px dialog with no
            scrollbar; mock data has 4 to 6 columns and never overflows. */}
        <div className={showTable ? 'flex min-h-0 min-w-0 [&>div]:min-w-0' : 'overflow-auto'}>
          {isFetching && (
            <div className="flex items-center justify-center gap-3 py-12">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Reading rows...</span>
            </div>
          )}
          {!isFetching && failure != null && (
            <div role="alert" className="space-y-2 p-4 text-sm">
              <p className="whitespace-pre-wrap text-destructive">{failure.message}</p>
              {failure.detail != null && (
                <details className="text-muted-foreground">
                  <summary className="cursor-pointer text-xs">What the data source said</summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs">
                    {failure.detail}
                  </pre>
                </details>
              )}
            </div>
          )}
          {showTable && <PreviewGrid data={data.data} />}
        </div>

        <div className="flex items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
          <span>
            {data != null && failure == null
              ? `${data.data.rows.length} ${data.data.rows.length === 1 ? 'row' : 'rows'}`
              : `First ${TABLE_PREVIEW_ROWS} rows`}
          </span>
          {data?.runtime != null && failure == null && <span>{data.runtime.toFixed(2)}s</span>}
          {/* Only for a read that happened: re-deriving it on the failure path
              would rebuild the refused statement during render. */}
          {target != null && failure == null && data != null && (
            <code className="ml-auto truncate font-mono">
              {tablePreviewSql(target.table.name).replace(/\n/g, ' ')}
            </code>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PreviewGrid({ data }: { data: QueryResultData }) {
  if (data.rows.length === 0) {
    // w-full: the parent is a flex row, and a flex item's width defaults to its
    // own content, so text-center would have nothing to center within.
    return <p className="w-full py-12 text-center text-sm text-muted-foreground">No rows</p>
  }
  return (
    <Table className="text-xs">
      <TableHeader className="sticky top-0 z-10 bg-popover">
        <TableRow className="border-b">
          {data.columns.map((col) => (
            <TableHead
              key={col.name}
              className="px-3 py-2 text-left font-mono font-medium whitespace-nowrap text-muted-foreground"
            >
              {col.friendly_name}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.rows.map((row, i) => (
          <TableRow key={i} className="hover:bg-muted/30">
            {data.columns.map((col) => (
              <TableCell key={col.name} className="max-w-[24rem] truncate px-3 py-1.5 whitespace-nowrap">
                {renderCell(row[col.name])}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// A preview shows what is stored, not a formatted reading of it.
function renderCell(value: unknown) {
  if (value == null) return <span className="text-muted-foreground italic">null</span>
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
