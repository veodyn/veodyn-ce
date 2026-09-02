'use client'

import { ArrowDown, ArrowUp } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/shared/icon-button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { QueryResultColumn } from '@/lib/mock-data'
import { effectiveColumnConfig, renumberColumnConfig } from '@/lib/table-columns'
import type { RedashTableColumnOptions, RedashTableOptions } from '@/services/redash/types'

interface TableEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  onChange: (options: Record<string, unknown>) => void
}

/** Redash's own kinds and labels, minus `json`, which nothing here renders. */
const DISPLAY_AS = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'datetime', label: 'Date and time' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'link', label: 'Link' },
  { value: 'image', label: 'Image' },
] as const

export function TableEditor({ options: rawOptions, columns, onChange }: TableEditorProps) {
  const options = rawOptions as RedashTableOptions
  const columnConfig = effectiveColumnConfig(columns, options.columns)

  const save = (next: RedashTableColumnOptions[]) => {
    onChange({ ...rawOptions, columns: renumberColumnConfig(next) })
  }

  const patch = (name: string, updates: Partial<RedashTableColumnOptions>) => {
    save(columnConfig.map((c) => (c.name === name ? { ...c, ...updates } : c)))
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= columnConfig.length) return
    const next = [...columnConfig]
    ;[next[index], next[target]] = [next[target], next[index]]
    save(next)
  }

  return (
    <div className="space-y-4">
      <div>
        {/* Heading for the list below, not a label for any one row: each row's checkbox has no text label of its own here. */}
        <div className="text-sm font-medium mb-2">Columns</div>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {columnConfig.map((col, i) => {
            const displayAs = col.displayAs ?? 'text'
            return (
              <div key={col.name} className="space-y-1.5 border-b pb-2 last:border-b-0">
                <div className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={col.visible !== false}
                    onCheckedChange={() => patch(col.name, { visible: col.visible === false })}
                  />
                  <Input
                    type="text"
                    value={col.title ?? ''}
                    onChange={(e) => patch(col.name, { title: e.target.value || undefined })}
                    placeholder={col.name}
                    className="flex-1 h-7 text-xs"
                  />
                  {/* The arrows reorder the table's columns, not the rows of this
                      editor, which is the reading a bare arrow invites. */}
                  <IconButton
                    tooltip="Move column up"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </IconButton>
                  <IconButton
                    tooltip="Move column down"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => move(i, 1)}
                    disabled={i === columnConfig.length - 1}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </IconButton>
                </div>

                <Select
                  value={displayAs}
                  onValueChange={(v) =>
                    v && patch(col.name, { displayAs: v as RedashTableColumnOptions['displayAs'] })
                  }
                >
                  {/* Named per column: a row of identical "Display as" selects
                      reads the same to a screen reader. */}
                  <SelectTrigger size="sm" aria-label={`Display ${col.name} as`} className="h-7">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISPLAY_AS.map((kind) => (
                      <SelectItem key={kind.value} value={kind.value}>
                        {kind.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {displayAs === 'link' && (
                  <div className="space-y-1">
                    <Input
                      aria-label={`${col.name} URL template`}
                      value={col.linkUrlTemplate ?? ''}
                      onChange={(e) => patch(col.name, { linkUrlTemplate: e.target.value })}
                      placeholder="/cameras/{{ @ }}"
                      className="h-7 text-xs"
                    />
                    <Input
                      aria-label={`${col.name} text template`}
                      value={col.linkTextTemplate ?? ''}
                      onChange={(e) => patch(col.name, { linkTextTemplate: e.target.value })}
                      placeholder="Link text (defaults to the URL)"
                      className="h-7 text-xs"
                    />
                  </div>
                )}

                {displayAs === 'image' && (
                  <div className="space-y-1">
                    <Input
                      aria-label={`${col.name} image URL template`}
                      value={col.imageUrlTemplate ?? ''}
                      onChange={(e) => patch(col.name, { imageUrlTemplate: e.target.value })}
                      placeholder="/snapshots/{{ @ }}.jpg"
                      className="h-7 text-xs"
                    />
                    <Input
                      aria-label={`${col.name} image title template`}
                      value={col.imageTitleTemplate ?? ''}
                      onChange={(e) => patch(col.name, { imageTitleTemplate: e.target.value })}
                      placeholder="Alt text, e.g. {{ label }}"
                      className="h-7 text-xs"
                    />
                  </div>
                )}

                {(displayAs === 'link' || displayAs === 'image') && (
                  <p className="text-xs text-muted-foreground">
                    {'{{ column }}'} reads another column, {'{{ @ }}'} reads this one.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
