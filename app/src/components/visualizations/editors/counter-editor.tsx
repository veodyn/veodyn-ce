'use client'

import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { QueryResultColumn } from '@/lib/mock-data'
import type { RedashCounterOptions } from '@/services/redash/types'

interface CounterEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  onChange: (options: Record<string, unknown>) => void
}

export function CounterEditor({ options: rawOptions, columns, onChange }: CounterEditorProps) {
  const options = rawOptions as RedashCounterOptions

  const counterLabelId = useId()
  const countRowId = useId()
  const counterColumnId = useId()
  const counterRowNumberId = useId()
  const targetColumnId = useId()
  const prefixId = useId()
  const suffixId = useId()
  const decimalPlacesId = useId()

  const update = (key: keyof RedashCounterOptions, value: unknown) => {
    onChange({ ...rawOptions, [key]: value })
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={counterLabelId} className="mb-1 block">Counter Label</Label>
        <Input
          id={counterLabelId}
          type="text"
          value={options.counterLabel || ''}
          onChange={(e) => update('counterLabel', e.target.value)}
          className="h-8"
          placeholder="Label text"
        />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Checkbox
          id={countRowId}
          checked={options.countRow === true}
          onCheckedChange={(checked) => update('countRow', checked || undefined)}
        />
        <Label htmlFor={countRowId}>Count rows</Label>
      </div>
      <div>
        <Label htmlFor={counterColumnId} className="mb-1 block">Counter Column</Label>
        <Select
          value={options.counterColName || ''}
          onValueChange={(v) => update('counterColName', v)}
          disabled={options.countRow === true}
        >
          <SelectTrigger id={counterColumnId} className="w-full h-8" disabled={options.countRow === true}>
            <SelectValue placeholder="First column" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">First column</SelectItem>
            {columns.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor={counterRowNumberId} className="mb-1 block">Counter Row Number</Label>
        <Input
          id={counterRowNumberId}
          type="number"
          min={1}
          value={options.rowNumber || 1}
          onChange={(e) => update('rowNumber', parseInt(e.target.value) || 1)}
          className="h-8"
          disabled={options.countRow === true}
        />
      </div>
      <div>
        <Label htmlFor={targetColumnId} className="mb-1 block">Target Column</Label>
        <Select
          value={options.targetColName || ''}
          onValueChange={(v) => update('targetColName', v || undefined)}
          disabled={options.countRow === true}
        >
          <SelectTrigger id={targetColumnId} className="w-full h-8" disabled={options.countRow === true}>
            <SelectValue placeholder="No target" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">No target</SelectItem>
            {columns.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">Compares against the same row&apos;s value in this column.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={prefixId} className="mb-1 block">Prefix</Label>
          <Input
            id={prefixId}
            type="text"
            value={options.stringPrefix || ''}
            onChange={(e) => update('stringPrefix', e.target.value || undefined)}
            className="h-8"
            placeholder="$"
          />
        </div>
        <div>
          <Label htmlFor={suffixId} className="mb-1 block">Suffix</Label>
          <Input
            id={suffixId}
            type="text"
            value={options.stringSuffix || ''}
            onChange={(e) => update('stringSuffix', e.target.value || undefined)}
            className="h-8"
            placeholder="%"
          />
        </div>
      </div>
      <div>
        <Label htmlFor={decimalPlacesId} className="mb-1 block">Decimal Places</Label>
        <Input
          id={decimalPlacesId}
          type="number"
          min={0}
          max={10}
          value={options.stringDecimal ?? ''}
          onChange={(e) => update('stringDecimal', e.target.value === '' ? undefined : parseInt(e.target.value))}
          className="h-8"
          placeholder="auto"
        />
      </div>
    </div>
  )
}
