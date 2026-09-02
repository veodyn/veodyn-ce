'use client'

import { useState, useMemo } from 'react'
import { Download, Search, ChevronDown } from 'lucide-react'
import type { QueryResultData } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { downloadCSV, downloadTSV } from '@/lib/download'
import { usePolicy } from '@/lib/policy'
import type { RedashTableColumnOptions } from '@/services/redash/types'
import { displayColumns } from '@/lib/filters/result-filters'
import { reorderColumns } from '@/lib/table-columns'
import { useColumnDrag } from '@/hooks/use-column-drag'
import { ResultCell } from './result-cell'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Table, TableHeader, TableBody, TableRow, TableHead } from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface QueryResultTableProps {
  data: QueryResultData
  className?: string
  columns?: RedashTableColumnOptions[]
  /**
   * The saved query behind these rows, when there is one. Only used to offer
   * the backend's own xlsx export; an ad hoc result has no URL to point at.
   */
  queryId?: number
  onColumnsChange?: (columns: RedashTableColumnOptions[]) => void
}

export function applyColumnConfig(data: QueryResultData, columnConfig?: RedashTableColumnOptions[]): QueryResultData {
  // Before anything else, because a `route_id::filter` column would otherwise
  // print its suffix as the header. The raw name is left alone: it keys the
  // rows, and the per-column config below is written against it too.
  data = { ...data, columns: displayColumns(data.columns) }

  if (!columnConfig || columnConfig.length === 0) return data

  const configByName = new Map(columnConfig.map((c) => [c.name, c]))
  const visible = data.columns.filter((c) => configByName.get(c.name)?.visible !== false)
  const ordered = [...visible].sort((a, b) => {
    const orderA = configByName.get(a.name)?.order ?? Infinity
    const orderB = configByName.get(b.name)?.order ?? Infinity
    return orderA - orderB
  })
  const columns = ordered.map((c) => {
    const title = configByName.get(c.name)?.title
    return title ? { ...c, friendly_name: title } : c
  })

  return { columns, rows: data.rows }
}

export function QueryResultTable({
  data: rawData,
  className,
  columns: columnConfig,
  queryId,
  onColumnsChange,
}: QueryResultTableProps) {
  const data = useMemo(() => applyColumnConfig(rawData, columnConfig), [rawData, columnConfig])
  const { dragProps, dragClassName } = useColumnDrag(
    onColumnsChange &&
      ((moved, target) => onColumnsChange(reorderColumns(rawData.columns, columnConfig, moved, target)))
  )
  // Keyed for the cells below, which each draw themselves the way their own
  // column says to. applyColumnConfig above only reshapes the header row.
  const configByName = useMemo(
    () => new Map((columnConfig ?? []).map((c) => [c.name, c])),
    [columnConfig]
  )
  // Hides the sanctioned way out of the product for a group carrying
  // no_export_data. It does not stop the data leaving: every row is already in
  // this component's props, so a reader with a console, or with the query's own
  // results.csv at the Redash origin, is unaffected. Removing the control is a
  // policy signal, not a boundary, and it is the whole of what was asked for.
  const canExport = usePolicy().canExportData()
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)
  const pageSize = 50

  const filteredRows = useMemo(() => {
    const visibleCols = data.columns.map((c) => c.name)
    let rows = data.rows
    if (search) {
      const s = search.toLowerCase()
      rows = rows.filter((row) =>
        visibleCols.some((name) =>
          String(row[name]).toLowerCase().includes(s)
        )
      )
    }
    if (sortCol) {
      rows = [...rows].sort((a, b) => {
        const aVal = a[sortCol]
        const bVal = b[sortCol]
        if (aVal == null) return 1
        if (bVal == null) return -1
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return rows
  }, [data.columns, data.rows, search, sortCol, sortDir])

  const pagedRows = filteredRows.slice(page * pageSize, (page + 1) * pageSize)
  const totalPages = Math.ceil(filteredRows.length / pageSize)

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <InputGroup className="w-48">
          <InputGroupAddon>
            <Search className="h-3.5 w-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            placeholder="Search results..."
          />
        </InputGroup>
        <span className="text-xs text-muted-foreground">
          {filteredRows.length} {filteredRows.length === 1 ? 'row' : 'rows'}
        </span>
        <div className="flex-1" />
        {canExport && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <Download className="h-3 w-3" />
              Download
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => downloadCSV(data)}>CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadTSV(data)}>TSV</DropdownMenuItem>
              {/* Only for a saved query: an ad hoc result has no URL behind it,
                  and a dead link is worse than no option. xlsx is not
                  hand-rolled here because Redash already generates it; the
                  proxy carries the bytes back untouched. */}
              {queryId != null && (
                <DropdownMenuItem
                  render={
                    <a href={`/api/node/queries/${queryId}/results.xlsx`} download />
                  }
                >
                  Excel (.xlsx)
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {/* Flex row (not overflow-auto) with min-h-0: the Table primitive wraps
          itself in its own overflow-x-auto div, so this used to be a second,
          nested scroll container stacked on top of that one. A div that only
          sets overflow-x also computes overflow-y as auto (the CSS overflow
          spec ties the two together once either one leaves "visible"), so
          that inner div silently became a scroll container too, and the
          sticky header, whose "nearest scrolling ancestor" is now that inner
          div instead of this one, stopped sticking the moment this div did
          the actual scrolling. Making this a flex row lets the inner div
          stretch to fill the available height (flex's default cross-axis
          stretch), so it becomes the one true scroll container for both axes
          and the sticky thead sticks to it correctly. Verified with an
          isolated repro (playwright + a scroll-then-measure check) before
          landing this. */}
      <div className="flex flex-1 min-h-0">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow className="border-b">
              {data.columns.map((col) => (
                <TableHead
                  key={col.name}
                  {...dragProps(col.name)}
                  onClick={() => handleSort(col.name)}
                  className={cn(
                    'text-left text-xs font-mono font-medium text-muted-foreground px-3 py-2 cursor-pointer hover:text-foreground whitespace-nowrap',
                    dragClassName(col.name)
                  )}
                >
                  {col.friendly_name}
                  {sortCol === col.name && (sortDir === 'asc' ? ' ↑' : ' ↓')}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedRows.map((row, i) => (
              <TableRow key={page * pageSize + i} className="hover:bg-muted/30">
                {data.columns.map((col) => (
                  <ResultCell
                    key={col.name}
                    value={row[col.name]}
                    row={row}
                    columnType={col.type}
                    config={configByName.get(col.name)}
                  />
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 px-3 py-2 border-t text-xs">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Prev
          </Button>
          <span className="text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}

