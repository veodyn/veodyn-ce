'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { MockQueryParameter } from '@/lib/mock-data'
import {
  DYNAMIC_DATES,
  DYNAMIC_DATE_RANGES,
  isDateRangeValue,
  isRangeType,
  type DateRangeValue,
} from '@/lib/parameters/dynamic-dates'
import { QueryBasedDropdown } from './query-based-dropdown'

interface ParameterControlProps {
  parameter: MockQueryParameter
  /** Id for the control the parameter's label points at. */
  id: string
  value: unknown
  onChange: (value: unknown) => void
}

/** Sentinel for the "not a preset, pick the dates yourself" option. */
const CUSTOM = 'custom'

/**
 * The `<input type>` and step for a date-ish parameter. `datetime-local` covers
 * both datetime types; only the step differs, since a control without one
 * silently drops the seconds the query asked for.
 */
function dateInputProps(type: string): { type: string; step?: string } {
  if (type === 'date' || type === 'date-range') return { type: 'date' }
  if (type === 'datetime-with-seconds' || type === 'datetime-range-with-seconds') {
    return { type: 'datetime-local', step: '1' }
  }
  return { type: 'datetime-local' }
}

function asRange(value: unknown): DateRangeValue {
  return isDateRangeValue(value) ? value : { start: '', end: '' }
}

function presetKeyOf(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('d_') ? value.slice(2) : null
}

function RangeControl({ parameter, value, onChange }: Omit<ParameterControlProps, 'id'>) {
  const title = parameter.title || parameter.name
  const inputProps = dateInputProps(parameter.type)
  const presetKey = presetKeyOf(value)
  const range = asRange(value)

  const setEnd = (end: keyof DateRangeValue, next: string) => {
    onChange({ ...range, [end]: next })
  }

  return (
    // A group rather than a single labelled control: there are up to three
    // inputs here, so the title names the set and each input carries its own
    // accessible name. A <Label htmlFor> could only ever point at one of them.
    <div role="group" aria-label={title} className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{title}</span>
      <div className="flex items-center gap-2">
        <Select
          value={presetKey ?? CUSTOM}
          onValueChange={(v) => onChange(v === CUSTOM ? { start: '', end: '' } : `d_${v}`)}
        >
          <SelectTrigger size="sm" aria-label={`${title} preset`} className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CUSTOM}>Custom range</SelectItem>
            {DYNAMIC_DATE_RANGES.map((preset) => (
              <SelectItem key={preset.key} value={preset.key}>
                {preset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Hidden rather than disabled while a preset is active: a preset has no
            fixed dates to show, so filled-in boxes would be a guess and empty
            ones would read as a range that failed to load. */}
        {!presetKey && (
          <>
            <Input
              {...inputProps}
              aria-label={`${title} start`}
              value={range.start}
              onChange={(e) => setEnd('start', e.target.value)}
              className="h-8"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              {...inputProps}
              aria-label={`${title} end`}
              value={range.end}
              onChange={(e) => setEnd('end', e.target.value)}
              className="h-8"
            />
          </>
        )}
      </div>
    </div>
  )
}

export function ParameterControl({ parameter, id, value, onChange }: ParameterControlProps) {
  const title = parameter.title || parameter.name

  if (isRangeType(parameter.type)) {
    return <RangeControl parameter={parameter} value={value} onChange={onChange} />
  }

  const isQueryWidget = parameter.type === 'query' && parameter.queryId
  const isDate = parameter.type === 'date' || parameter.type.startsWith('datetime')
  // Redash offers "allow multiple values" on enum and query parameters only,
  // and marks it by giving the definition a multiValuesOptions object. The
  // prefix/suffix/separator it carries are applied by the backend from the
  // query's schema, so this control collects a list and joins nothing.
  const isMulti = Boolean(parameter.multiValuesOptions)
  const selected = Array.isArray(value) ? value : []

  return (
    <div className="flex flex-col gap-1">
      {/* Every branch below sets `id={id}` on its own real control
          (QueryBasedDropdown forwards it onto its SelectTrigger, the same
          mechanism the Select/Input branches use), so the Label only ever needs
          `htmlFor` here, never its own `id`. Giving the Label an id equal to
          `id` too would collide with the control's and make `for` resolve back
          to the label itself. */}
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {title}
      </Label>
      {isQueryWidget ? (
        <QueryBasedDropdown
          id={id}
          queryId={parameter.queryId as number}
          value={value}
          onChange={onChange}
          multiple={isMulti}
        />
      ) : parameter.type === 'enum' && isMulti ? (
        <Select multiple value={selected} onValueChange={onChange}>
          <SelectTrigger id={id} size="sm" className="min-w-32">
            <SelectValue placeholder="None">
              {(v: string[]) =>
                v.length === 0 ? 'None' : v.length === 1 ? v[0] : `${v.length} selected`
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(parameter.enumOptions ?? '').split('\n').map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : parameter.type === 'enum' ? (
        <Select value={String(value ?? '')} onValueChange={onChange}>
          <SelectTrigger id={id} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(parameter.enumOptions ?? '').split('\n').map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : isDate ? (
        <div className="flex items-center gap-2">
          <Input
            {...dateInputProps(parameter.type)}
            id={id}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            className="h-8"
          />
          <Select
            value={presetKeyOf(value) ?? CUSTOM}
            onValueChange={(v) => onChange(v === CUSTOM ? '' : `d_${v}`)}
          >
            <SelectTrigger size="sm" aria-label={`${title} preset`} className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CUSTOM}>Exact date</SelectItem>
              {DYNAMIC_DATES.map((preset) => (
                <SelectItem key={preset.key} value={preset.key}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <Input
          id={id}
          type={parameter.type === 'number' ? 'number' : 'text'}
          value={String(value ?? '')}
          onChange={(e) =>
            onChange(parameter.type === 'number' ? Number(e.target.value) : e.target.value)
          }
          className="h-8 w-32"
        />
      )}
    </div>
  )
}
