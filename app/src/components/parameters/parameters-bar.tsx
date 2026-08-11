'use client'

import { useEffect, useId, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/icon-button'
import type { MockQueryParameter } from '@/lib/mock-data'
import { sameParameterValue } from '@/lib/parameters/dynamic-dates'
import { ParameterControl } from './parameter-control'

interface ParametersBarProps {
  parameters: MockQueryParameter[]
  onChange: (values: Record<string, unknown>) => void
  /**
   * How many edits are typed but not yet applied. The page that owns the run
   * needs this: an edit is pending until Apply commits it, so a run started
   * from anywhere else would silently use the previous values.
   */
  onDirtyChange?: (count: number) => void
  /**
   * Opens a parameter's settings. Only the editor supplies this: on a query or
   * a dashboard the bar runs things, it does not define them.
   */
  onEditParameter?: (parameter: MockQueryParameter) => void
}

function initialValues(parameters: MockQueryParameter[]): Record<string, unknown> {
  const initial: Record<string, unknown> = {}
  for (const p of parameters) {
    initial[p.name] = p.value
  }
  return initial
}

export function ParametersBar({
  parameters,
  onChange,
  onDirtyChange,
  onEditParameter,
}: ParametersBarProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(parameters))
  // The last committed values, which is what "pending" is measured against.
  // Held separately from `values` rather than read off the `parameters` prop,
  // because applying does not write back to the saved query: after an Apply the
  // baseline has moved even though the prop has not.
  const [applied, setApplied] = useState<Record<string, unknown>>(() => initialValues(parameters))
  // One useId() call, suffixed per parameter: parameters render from a .map(),
  // and hooks cannot be called inside a loop, so a single stable prefix plus
  // each parameter's own (already-unique, already used as the list `key`) name
  // is what stands in for one id-per-row.
  const baseId = useId()

  // Read through the prop for anything the state has not seen. The editor grows
  // its parameter list as the SQL is typed, and both state maps are seeded once
  // at mount, so a parameter that appeared later would otherwise render blank
  // and send nothing for a value the backend requires.
  const valueOf = (p: MockQueryParameter) => (p.name in values ? values[p.name] : p.value)
  const appliedOf = (p: MockQueryParameter) => (p.name in applied ? applied[p.name] : p.value)

  const dirtyCount = parameters.filter((p) => !sameParameterValue(valueOf(p), appliedOf(p))).length

  useEffect(() => {
    onDirtyChange?.(dirtyCount)
  }, [dirtyCount, onDirtyChange])

  const handleChange = (name: string, value: unknown) => {
    setValues({ ...values, [name]: value })
  }

  const handleApply = () => {
    // Built from the parameter list, not from `values`, so a parameter that
    // appeared after mount and was never touched is still sent. Omitting it
    // would have the backend refuse the run for a missing value.
    const complete = Object.fromEntries(parameters.map((p) => [p.name, valueOf(p)]))
    setApplied(complete)
    onChange(complete)
  }

  if (parameters.length === 0) return null

  return (
    <div className="flex items-end gap-3 p-3 bg-card border rounded-md mb-4 flex-wrap">
      {parameters.map((param) => (
        <div key={param.name} className="flex items-end gap-1">
          <ParameterControl
            parameter={param}
            id={`${baseId}-${param.name}`}
            value={valueOf(param)}
            onChange={(value) => handleChange(param.name, value)}
          />
          {/* Named per parameter: a row of identical "Settings" buttons reads
              the same to a screen reader, and this bar is a row by nature. */}
          {onEditParameter && (
            <IconButton
              tooltip={`Settings for ${param.title || param.name}`}
              variant="ghost"
              size="icon-xs"
              className="mb-1"
              onClick={() => onEditParameter(param)}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
      ))}
      <Button onClick={handleApply} className="h-8">
        Apply Changes
      </Button>
      {/* Beside the button rather than inside it, so the button keeps a stable
          accessible name while the count still reaches a screen reader as it
          changes. Rendered only when something is pending: a permanent
          "0 changes" is noise a live region would keep announcing. */}
      {dirtyCount > 0 && (
        <span role="status" className="self-center text-xs text-muted-foreground">
          {dirtyCount === 1 ? '1 change not applied' : `${dirtyCount} changes not applied`}
        </span>
      )}
    </div>
  )
}
