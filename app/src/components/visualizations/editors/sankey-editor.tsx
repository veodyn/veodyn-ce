'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { QueryResultColumn } from '@/lib/mock-data'

interface SankeyEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  onChange: (options: Record<string, unknown>) => void
}

const ROLES = [
  { value: '', label: '-- unused --' },
  { value: 'source', label: 'Source' },
  { value: 'target', label: 'Target' },
  { value: 'value', label: 'Value' },
]

export function SankeyEditor({ options, columns, onChange }: SankeyEditorProps) {
  const columnMapping = (options.columnMapping as Record<string, string>) || {}

  const updateMapping = (col: string, role: string) => {
    const next = { ...columnMapping }
    if (role === '') {
      delete next[col]
    } else {
      next[col] = role
    }
    onChange({ ...options, columnMapping: next })
  }

  return (
    <div className="space-y-4">
      <div>
        {/* Heading over the repeated selects below, not a label for any one of them; none of these rows has a per-row accessible name yet. */}
        <div className="text-sm font-medium mb-2">Column Mapping</div>
        <div className="space-y-2">
          {columns.map((col) => (
            <div key={col.name} className="flex items-center gap-2">
              <span className="text-sm w-32 truncate" title={col.name}>{col.name}</span>
              <Select
                value={columnMapping[col.name] || ''}
                items={ROLES}
                onValueChange={(v) => updateMapping(col.name, v ?? '')}
              >
                <SelectTrigger className="flex-1 w-full h-7 text-xs">
                  <SelectValue placeholder="-- unused --" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
