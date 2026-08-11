'use client'

import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { QueryResultColumn } from '@/lib/mock-data'

interface PivotEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  onChange: (options: Record<string, unknown>) => void
}

const AGGREGATIONS = ['sum', 'avg', 'count', 'min', 'max']

export function PivotEditor({ options, columns, onChange }: PivotEditorProps) {
  const rowFieldId = useId()
  const colFieldId = useId()
  const valueFieldId = useId()
  const aggregationId = useId()

  const update = (key: string, value: unknown) => {
    onChange({ ...options, [key]: value })
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={rowFieldId} className="mb-1 block">Row Field</Label>
        <Select
          value={(options.rowField as string) || ''}
          onValueChange={(v) => update('rowField', v)}
        >
          <SelectTrigger id={rowFieldId} className="w-full h-8">
            <SelectValue placeholder="Select column..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Select column...</SelectItem>
            {columns.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor={colFieldId} className="mb-1 block">Column Field</Label>
        <Select
          value={(options.colField as string) || ''}
          onValueChange={(v) => update('colField', v)}
        >
          <SelectTrigger id={colFieldId} className="w-full h-8">
            <SelectValue placeholder="Select column..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Select column...</SelectItem>
            {columns.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor={valueFieldId} className="mb-1 block">Value Field</Label>
        <Select
          value={(options.valueField as string) || ''}
          onValueChange={(v) => update('valueField', v)}
        >
          <SelectTrigger id={valueFieldId} className="w-full h-8">
            <SelectValue placeholder="Select column..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Select column...</SelectItem>
            {columns.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor={aggregationId} className="mb-1 block">Aggregation</Label>
        <Select
          value={(options.aggregation as string) || 'sum'}
          onValueChange={(v) => update('aggregation', v)}
        >
          <SelectTrigger id={aggregationId} className="w-full h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGGREGATIONS.map((a) => (
              <SelectItem key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
