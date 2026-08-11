'use client'

import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { QueryResultColumn } from '@/lib/mock-data'
import type { RedashMapOptions } from '@/services/redash/types'

interface MapEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  onChange: (options: Record<string, unknown>) => void
}

export function MapEditor({ options: rawOptions, columns, onChange }: MapEditorProps) {
  const options = rawOptions as RedashMapOptions

  const latColumnId = useId()
  const lonColumnId = useId()
  const groupById = useId()
  const popupTemplateId = useId()

  const update = (key: keyof RedashMapOptions, value: unknown) => {
    onChange({ ...rawOptions, [key]: value })
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={latColumnId} className="mb-1 block">Latitude Column</Label>
        <Select value={options.latColName || ''} onValueChange={(v) => update('latColName', v)}>
          <SelectTrigger id={latColumnId} className="w-full h-8">
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
        <Label htmlFor={lonColumnId} className="mb-1 block">Longitude Column</Label>
        <Select value={options.lonColName || ''} onValueChange={(v) => update('lonColName', v)}>
          <SelectTrigger id={lonColumnId} className="w-full h-8">
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
        <Label htmlFor={groupById} className="mb-1 block">Group By (marker color)</Label>
        <Select
          value={options.classify || ''}
          onValueChange={(v) => update('classify', v || undefined)}
        >
          <SelectTrigger id={groupById} className="w-full h-8">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">None</SelectItem>
            {columns.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor={popupTemplateId} className="mb-1 block">Popup Template</Label>
        <Textarea
          id={popupTemplateId}
          value={options.popup?.template || ''}
          onChange={(e) => update('popup', { ...options.popup, enabled: true, template: e.target.value })}
          placeholder="{{ column_name }}, or leave blank to show all columns"
          rows={3}
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground mt-1">Shown when a marker is clicked. Reference any column with {'{{ column_name }}'}.</p>
      </div>
    </div>
  )
}
