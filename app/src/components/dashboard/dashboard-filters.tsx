'use client'

import { useId, useState, useMemo } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { QueryResultData } from '@/lib/mock-data'
import { detectResultFilters } from '@/lib/filters/result-filters'

interface DashboardFiltersProps {
  allResults: QueryResultData[]
  onFilterChange: (filters: Record<string, string[]>) => void
}

interface FilterableColumn {
  /** Raw column name, which is the key in every row. */
  name: string
  /** What the control is labelled with. */
  label: string
  values: string[]
}

/**
 * Which columns filter this dashboard.
 *
 * An author who named a column `route_id::filter` has said so explicitly, and
 * that answer wins. The guess below (any string column with a handful of
 * distinct values) stays for dashboards built before the convention was
 * supported, but it is only ever a fallback.
 *
 * A plain function rather than an inline useMemo body: the early return past a
 * pile of accumulation is something the React Compiler will not memoize
 * through, and it fails the build rather than silently deoptimizing.
 */
function filterableColumnsOf(allResults: QueryResultData[]): FilterableColumn[] {
  const declared = new Map<string, FilterableColumn & { values: string[] }>()
  for (const result of allResults) {
    for (const filter of detectResultFilters(result)) {
      const entry = declared.get(filter.name) ?? {
        name: filter.name,
        label: filter.friendlyName,
        values: [],
      }
      for (const value of filter.values) {
        if (!entry.values.includes(value)) entry.values.push(value)
      }
      declared.set(filter.name, entry)
    }
  }
  if (declared.size > 0) {
    return [...declared.values()].map((entry) => ({ ...entry, values: [...entry.values].sort() }))
  }

  const colValues = new Map<string, Set<string>>()
  for (const result of allResults) {
    for (const col of result.columns) {
      if (col.type === 'string' || col.type === 'text') {
        if (!colValues.has(col.name)) colValues.set(col.name, new Set())
        for (const row of result.rows) {
          const val = row[col.name]
          if (val != null) colValues.get(col.name)?.add(String(val))
        }
      }
    }
  }
  return Array.from(colValues.entries())
    .filter(([, vals]) => vals.size > 1 && vals.size <= 50)
    .map(([name, vals]) => ({ name, label: name, values: [...vals].sort() }))
}

export function DashboardFilters({ allResults, onFilterChange }: DashboardFiltersProps) {
  const [filters, setFilters] = useState<Record<string, string[]>>({})
  // One call, suffixed per column below: columns are derived from allResults
  // and rendered via .map(), and useId() cannot be called inside a loop.
  const baseId = useId()

  const filterableColumns = useMemo(() => filterableColumnsOf(allResults), [allResults])

  if (filterableColumns.length === 0) return null

  return (
    <div className="flex items-end gap-3 p-3 bg-card border rounded-md mb-4 flex-wrap">
      {filterableColumns.map((col) => {
        const filterId = `${baseId}-${col.name}`
        return (
          <div key={col.name} className="flex flex-col gap-1">
            <Label htmlFor={filterId} className="text-xs text-muted-foreground">
              {/* The label, not the raw name: a declared filter column carries
                  a `::filter` suffix that is an instruction to this component
                  rather than something to show the reader. */}
              {col.label}
            </Label>
            <Select
              multiple
              value={filters[col.name] || []}
              onValueChange={(selected) => {
                const updated = { ...filters, [col.name]: selected }
                if (selected.length === 0) delete updated[col.name]
                setFilters(updated)
                onFilterChange(updated)
              }}
            >
              <SelectTrigger id={filterId} size="sm" className="min-w-[120px]">
                <SelectValue placeholder="All">
                  {(value: string[]) => (value.length > 0 ? `${value.length} selected` : 'All')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {col.values.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      })}
    </div>
  )
}
