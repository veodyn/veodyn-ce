'use client'

import { useMemo, useState, type KeyboardEvent } from 'react'
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { NoData } from '@/components/ui/no-data'
import { Paginator } from '@/components/shared/paginator'
import { cn } from '@/lib/utils'

// A column is sortable when it supplies the value to sort on, not a boolean.
export type SortValue = string | number | boolean | null | undefined

/** Rows per page for the library lists, so they all break at the same place. */
export const LIST_PAGE_SIZE = 25

export interface Column<T> {
  key: string
  title: string
  render: (item: T) => React.ReactNode
  /** Provide to make the column sortable. */
  sortValue?: (item: T) => SortValue
  width?: string
}

export interface SortState {
  key: string
  dir: 'asc' | 'desc'
}

interface ItemsTableProps<T> {
  columns: Column<T>[]
  items: T[]
  rowKey: (item: T) => string | number
  onRowClick?: (item: T) => void
  className?: string
  emptyMessage?: string
  /** Order to open in. Omit to show the order the caller supplied. */
  defaultSort?: SortState
  /**
   * Rows per page. Omit to render every row with no paginator, which is what
   * the short lists (a dashboard's widgets, a group's members) want.
   *
   * Paging lives here rather than in the caller because sorting does: a caller
   * that sliced first would leave the header sorting only the current page.
   */
  pageSize?: number
  /**
   * Change this to send the reader back to page 1. A new search or a new tab is
   * a different list; re-sorting the same list is not, so sorting keeps the page.
   */
  pageKey?: string | number
}

// Empty and absent sort last in both directions: "no value" is missing, not
// smaller than every value.
function compare(a: SortValue, b: SortValue, direction: 1 | -1): number {
  const aMissing = a === null || a === undefined || a === ''
  const bMissing = b === null || b === undefined || b === ''
  if (aMissing && bMissing) return 0
  // Past the direction, not through it: reversing must not promote the rows
  // with nothing in this column to the top.
  if (aMissing) return 1
  if (bMissing) return -1
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction
  if (typeof a === 'boolean' && typeof b === 'boolean') return (Number(a) - Number(b)) * direction
  return (
    String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }) * direction
  )
}

export function ItemsTable<T>({
  columns,
  items,
  rowKey,
  onRowClick,
  className,
  emptyMessage = 'No items found',
  defaultSort,
  pageSize,
  pageKey,
}: ItemsTableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null)
  const [page, setPage] = useState(1)

  // Adjusting state during render, React's own answer to "reset when a prop
  // changes": this re-renders before anything is committed, so page 1 is all the
  // reader sees. An effect would paint page 4 of the new list first.
  const [seenPageKey, setSeenPageKey] = useState(pageKey)
  if (pageKey !== seenPageKey) {
    setSeenPageKey(pageKey)
    setPage(1)
  }

  const handleSort = (key: string) => {
    setSort((current) =>
      current?.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    )
  }

  const sorted = useMemo(() => {
    const column = sort ? columns.find((c) => c.key === sort.key) : undefined
    if (!sort || !column?.sortValue) return items
    const sortValue = column.sortValue
    const direction: 1 | -1 = sort.dir === 'asc' ? 1 : -1
    // A copy: mutating the caller's array would reorder the hook cache it came
    // from and make the order depend on which page rendered first.
    return [...items].sort((a, b) => compare(sortValue(a), sortValue(b), direction))
  }, [columns, items, sort])

  const totalPages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1
  // Clamped on the way out rather than corrected in state: archiving the last
  // row of the last page lands the reader on the new last page, not an empty
  // table, with no second render.
  const currentPage = Math.min(page, totalPages)
  const visible = pageSize
    ? sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : sorted

  if (items.length === 0) {
    // `card` stays off because every caller puts this inside a bordered panel
    // of its own.
    return <NoData message={emptyMessage} />
  }

  return (
    <>
      <div className={cn('overflow-x-auto', className)}>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => {
                const active = sort?.key === col.key
                return (
                  <TableHead
                    key={col.key}
                    scope="col"
                    aria-sort={
                      col.sortValue
                        ? active
                          ? sort.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                        : undefined
                    }
                    className={cn(
                      'text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider px-4 py-3',
                      col.width
                    )}
                  >
                    {col.sortValue ? (
                      // A button, not a click handler on the th: a header you can
                      // only reach with a mouse is not a control.
                      //
                      // `text-xs` is restated even though the th declares it:
                      // Button's base cva sets `text-sm` on the element itself,
                      // which beats inheritance, so without it sortable headers
                      // render at 14px and the `<span>` branch below at 12px.
                      <Button
                        variant="ghost"
                        onClick={() => handleSort(col.key)}
                        className="h-auto gap-1 p-0 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:bg-transparent hover:text-foreground"
                      >
                        {col.title}
                        {active ? (
                          sort.dir === 'asc' ? (
                            <ChevronUp className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="h-3 w-3" aria-hidden="true" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />
                        )}
                      </Button>
                    ) : (
                      <span className="inline-flex items-center gap-1">{col.title}</span>
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((item) => (
              <TableRow
                key={rowKey(item)}
                // A clickable row is a control, so it gets keyboard operability.
                // Only when onRowClick is supplied: a static row must not be in
                // the tab order.
                //
                // No role="button": on a <tr> it computes its accessible name
                // from all descendant text, swallowing the label of a real action
                // button in a cell (archive-restore.test.tsx catches this), and
                // nesting a control inside a role="button" ancestor is invalid
                // ARIA. The implicit row role keeps both names intact.
                {...(onRowClick && {
                  tabIndex: 0,
                  onClick: () => onRowClick(item),
                  onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onRowClick(item)
                    }
                  },
                })}
                className={cn(onRowClick && 'cursor-pointer')}
              >
                {columns.map((col) => (
                  <TableCell key={col.key} className="px-4 py-3 text-sm">
                    {col.render(item)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {/* Paginator renders nothing at one page. mb-4 because every caller puts
          the table inside a bordered panel, and the controls should not sit on
          its edge. */}
      {pageSize ? (
        <Paginator
          page={currentPage}
          totalPages={totalPages}
          onChange={setPage}
          className="mb-4"
        />
      ) : null}
    </>
  )
}
