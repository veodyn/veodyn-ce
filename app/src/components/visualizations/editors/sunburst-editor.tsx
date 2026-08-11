'use client'

import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { QueryResultColumn } from '@/lib/mock-data'
import type { RedashSunburstOptions } from '@/services/redash/types'

interface SunburstEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  onChange: (options: Record<string, unknown>) => void
}

// Mirrors SEQUENCE_FIELDS in sunburst-model.ts. A result carrying all four of
// these column names is read as Redash's edge-list sequence format, which
// builds its own hierarchy and ignores every option below. Kept as a local
// copy rather than exported from the model so the editor does not pull the
// renderer's module graph into the options panel.
const SEQUENCE_FIELDS = ['sequence', 'stage', 'node', 'value']

// The select needs a concrete value for the "Automatic" row, but that value
// must never reach the saved options: buildTableEntries resolves the value
// column with `??`, so a stored '' is a real answer that beats both fallbacks
// (a column literally named 'value', then the last column) and sizes every
// slice 0. Picking Automatic deletes the key instead of writing this sentinel.
const AUTOMATIC = ''

export function SunburstEditor({ options: rawOptions, columns, onChange }: SunburstEditorProps) {
  const options = rawOptions as RedashSunburstOptions

  const valueColumnId = useId()

  const columnNames = columns.map((c) => c.name)
  const isSequenceFormat = SEQUENCE_FIELDS.every((field) => columnNames.includes(field))

  const update = (key: keyof RedashSunburstOptions, value: unknown) => {
    onChange({ ...rawOptions, [key]: value })
  }

  // Absence of the key is what re-enables the model's own resolution, so unset
  // has to delete rather than write undefined: an explicit `valueColumn: undefined`
  // survives a spread and reads as a configured field everywhere else.
  const unset = (key: keyof RedashSunburstOptions) => {
    const next = { ...rawOptions }
    delete next[key]
    onChange(next)
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={valueColumnId} className="mb-1 block">Value Column</Label>
        <Select
          value={options.valueColumn ?? AUTOMATIC}
          onValueChange={(v: string | null) => {
            const choice = v ?? AUTOMATIC
            if (choice === AUTOMATIC) {
              unset('valueColumn')
            } else {
              update('valueColumn', choice)
            }
          }}
        >
          <SelectTrigger id={valueColumnId} className="w-full h-8">
            <SelectValue placeholder="Automatic" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTOMATIC}>Automatic</SelectItem>
            {columns.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          Sizes each slice. Automatic uses a column named &quot;value&quot;, or the last column. Every other column becomes a hierarchy level, in column order.
        </p>
      </div>
      {isSequenceFormat && (
        // Without this the picker looks broken: the result already has
        // sequence, stage, node and value, so the renderer takes the edge-list
        // path and no choice here changes the chart.
        <p className="text-xs text-muted-foreground">
          This result is already in sequence format (sequence, stage, node, value), so the hierarchy comes from those columns and the value column above is ignored.
        </p>
      )}
    </div>
  )
}
