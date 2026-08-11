'use client'

import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { QueryResultColumn } from '@/lib/mock-data'
import type { RedashKpiHistoryOptions } from '@/services/redash/types'

type TargetOption = NonNullable<RedashKpiHistoryOptions['target']>
type ThresholdsOption = NonNullable<RedashKpiHistoryOptions['thresholds']>

interface KpiHistoryEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  onChange: (options: Record<string, unknown>) => void
}

/**
 * A number field's value, or undefined when the field is empty.
 *
 * Empty has to come back as undefined rather than 0: a cleared target is "no
 * target", and 0 is a target of zero, which for a lower-is-better KPI is a real
 * and very different thing to ask for.
 */
function numberOrUndefined(raw: string): number | undefined {
  if (raw === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/**
 * Drop a nested group once every field in it has been cleared.
 *
 * Left as `{}` it would still be a present key, and both the renderer and
 * `validate` ask "is there a target at all?" before asking what is in it. An
 * empty object would answer yes and then draw nothing.
 */
function pruned<T extends object>(group: T): T | undefined {
  return Object.values(group).some((value) => value !== undefined) ? group : undefined
}

export function KpiHistoryEditor({ options: rawOptions, columns, onChange }: KpiHistoryEditorProps) {
  const options = rawOptions as RedashKpiHistoryOptions

  const timeColumnId = useId()
  const valueColumnId = useId()
  const unitId = useId()
  const targetValueId = useId()
  const directionId = useId()
  const atRiskId = useId()
  const breachedId = useId()

  const update = (key: keyof RedashKpiHistoryOptions, value: unknown) => {
    onChange({ ...rawOptions, [key]: value })
  }

  const updateTarget = (patch: Partial<TargetOption>) => {
    update('target', pruned({ ...options.target, ...patch }))
  }

  const updateThresholds = (patch: Partial<ThresholdsOption>) => {
    update('thresholds', pruned({ ...options.thresholds, ...patch }))
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={timeColumnId} className="mb-1 block">Time Column</Label>
        <Select
          value={options.timeColumn || ''}
          onValueChange={(v) => update('timeColumn', v || undefined)}
        >
          <SelectTrigger id={timeColumnId} className="w-full h-8">
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
        <Label htmlFor={valueColumnId} className="mb-1 block">Value Column</Label>
        <Select
          value={options.valueColumn || ''}
          onValueChange={(v) => update('valueColumn', v || undefined)}
        >
          <SelectTrigger id={valueColumnId} className="w-full h-8">
            <SelectValue placeholder="Second column" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Second column</SelectItem>
            {columns.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor={unitId} className="mb-1 block">Unit</Label>
        <Input
          id={unitId}
          type="text"
          value={options.unit || ''}
          onChange={(e) => update('unit', e.target.value || undefined)}
          className="h-8"
          placeholder="%"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={targetValueId} className="mb-1 block">Target</Label>
          <Input
            id={targetValueId}
            type="number"
            value={options.target?.value ?? ''}
            onChange={(e) => updateTarget({ value: numberOrUndefined(e.target.value) })}
            className="h-8"
            placeholder="No target"
          />
        </div>
        <div>
          <Label htmlFor={directionId} className="mb-1 block">Direction</Label>
          <Select
            value={options.target?.direction || 'higher-is-better'}
            onValueChange={(v) => updateTarget({ direction: v as TargetOption['direction'] })}
          >
            <SelectTrigger id={directionId} className="w-full h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="higher-is-better">Higher is better</SelectItem>
              <SelectItem value="lower-is-better">Lower is better</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={atRiskId} className="mb-1 block">At Risk</Label>
          <Input
            id={atRiskId}
            type="number"
            value={options.thresholds?.atRisk ?? ''}
            onChange={(e) => updateThresholds({ atRisk: numberOrUndefined(e.target.value) })}
            className="h-8"
            placeholder="No band"
          />
        </div>
        <div>
          <Label htmlFor={breachedId} className="mb-1 block">Breached</Label>
          <Input
            id={breachedId}
            type="number"
            value={options.thresholds?.breached ?? ''}
            onChange={(e) => updateThresholds({ breached: numberOrUndefined(e.target.value) })}
            className="h-8"
            placeholder="No band"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        The target and both thresholds are read together: the y axis is built to contain all
        three, so setting some and not others draws no status bands.
      </p>
    </div>
  )
}
