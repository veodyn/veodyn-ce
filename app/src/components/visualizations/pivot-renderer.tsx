'use client'

import { useMemo } from 'react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'

interface PivotRendererProps {
  visualization: MockVisualization
  data: QueryResultData
}

export function PivotRenderer({ visualization, data }: PivotRendererProps) {
  const options = visualization.options as Record<string, unknown>
  const rowField = (options.rowField as string) || data.columns[0]?.name || ''
  const colField = (options.colField as string) || data.columns[1]?.name || ''
  const valueField = (options.valueField as string) || data.columns[2]?.name || ''
  const aggregation = (options.aggregation as string) || 'sum'

  const { rowKeys, colKeys, pivotData } = useMemo(() => {
    const rKeys = new Set<string>()
    const cKeys = new Set<string>()
    const cells = new Map<string, number[]>()

    for (const row of data.rows) {
      const rk = String(row[rowField] ?? '')
      const ck = String(row[colField] ?? '')
      const val = Number(row[valueField]) || 0
      rKeys.add(rk)
      cKeys.add(ck)
      const key = `${rk}__${ck}`
      let bucket = cells.get(key)
      if (!bucket) {
        bucket = []
        cells.set(key, bucket)
      }
      bucket.push(val)
    }

    const aggregate = (vals: number[]): number => {
      if (!vals || vals.length === 0) return 0
      switch (aggregation) {
        case 'avg': return vals.reduce((a, b) => a + b, 0) / vals.length
        case 'count': return vals.length
        case 'min': return Math.min(...vals)
        case 'max': return Math.max(...vals)
        default: return vals.reduce((a, b) => a + b, 0)
      }
    }

    const pd = new Map<string, number>()
    for (const [key, vals] of cells) {
      pd.set(key, aggregate(vals))
    }

    return { rowKeys: [...rKeys], colKeys: [...cKeys], pivotData: pd }
  }, [data.rows, rowField, colField, valueField, aggregation])

  if (!rowField || !colField || !valueField) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Configure row, column, and value fields to display pivot table.
      </div>
    )
  }

  return (
    <div className="overflow-auto p-2">
      <Table className="border-collapse">
        <TableHeader>
          <TableRow>
            <TableHead className="text-left px-3 py-2 bg-muted font-medium text-muted-foreground border">
              {rowField} / {colField}
            </TableHead>
            {colKeys.map((ck) => (
              <TableHead key={ck} className="text-right px-3 py-2 bg-muted font-medium text-muted-foreground border whitespace-nowrap">
                {ck}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rowKeys.map((rk) => (
            <TableRow key={rk} className="hover:bg-muted/30">
              <TableCell className="px-3 py-1.5 font-medium border whitespace-nowrap">{rk}</TableCell>
              {colKeys.map((ck) => {
                const val = pivotData.get(`${rk}__${ck}`)
                return (
                  <TableCell key={ck} className="text-right px-3 py-1.5 border tabular-nums">
                    {val != null ? val.toLocaleString() : '-'}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
