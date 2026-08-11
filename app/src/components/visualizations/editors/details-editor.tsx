'use client'

import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { QueryResultColumn } from '@/lib/mock-data'

interface DetailsEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  onChange: (options: Record<string, unknown>) => void
}

export function DetailsEditor({ options, columns, onChange }: DetailsEditorProps) {
  const idPrefix = useId()
  const visibleColumns = (options.columns as string[]) || []

  const toggleColumn = (name: string) => {
    const next = visibleColumns.includes(name)
      ? visibleColumns.filter((c) => c !== name)
      : [...visibleColumns, name]
    onChange({ ...options, columns: next })
  }

  const allVisible = visibleColumns.length === 0

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          {/* Heading for the checkbox list below, not a label for any one of them; each row gets its own id from idPrefix. */}
          <div className="text-sm font-medium">Visible Columns</div>
          <Button
            variant="link"
            size="xs"
            onClick={() => onChange({ ...options, columns: [] })}
            className="h-auto p-0 text-xs"
          >
            Show All
          </Button>
        </div>
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {columns.map((col, index) => {
            const columnId = `${idPrefix}-${index}`
            return (
              <div key={col.name} className="flex items-center gap-2 text-sm py-1">
                <Checkbox
                  id={columnId}
                  checked={allVisible || visibleColumns.includes(col.name)}
                  onCheckedChange={() => {
                    if (allVisible) {
                      onChange({ ...options, columns: columns.filter((c) => c.name !== col.name).map((c) => c.name) })
                    } else {
                      toggleColumn(col.name)
                    }
                  }}
                />
                <Label htmlFor={columnId}>{col.friendly_name}</Label>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
