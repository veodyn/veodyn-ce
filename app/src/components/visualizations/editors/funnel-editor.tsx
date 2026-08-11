'use client'

import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { QueryResultColumn } from '@/lib/mock-data'

interface FunnelEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  onChange: (options: Record<string, unknown>) => void
}

export function FunnelEditor({ options, columns, onChange }: FunnelEditorProps) {
  const stepColumnId = useId()
  const valueColumnId = useId()
  const sortOrderId = useId()

  const update = (key: string, value: unknown) => {
    onChange({ ...options, [key]: value })
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={stepColumnId} className="mb-1 block">Step Column</Label>
        <Select
          value={(options.stepColumn as string) || ''}
          onValueChange={(v) => update('stepColumn', v)}
        >
          <SelectTrigger id={stepColumnId} className="w-full h-8">
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
        <Label htmlFor={valueColumnId} className="mb-1 block">Value Column</Label>
        <Select
          value={(options.valueColumn as string) || ''}
          onValueChange={(v) => update('valueColumn', v)}
        >
          <SelectTrigger id={valueColumnId} className="w-full h-8">
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
        <Label htmlFor={sortOrderId} className="mb-1 block">Sort Order</Label>
        <Select
          value={(options.sortOrder as string) || 'desc'}
          onValueChange={(v) => update('sortOrder', v)}
        >
          <SelectTrigger id={sortOrderId} className="w-full h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Descending (largest first)</SelectItem>
            <SelectItem value="asc">Ascending (smallest first)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
