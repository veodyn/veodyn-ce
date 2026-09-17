'use client'

import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SUBSECTION_HEADING } from '@/lib/section-heading'
import type { GtfsField } from '@/lib/gtfs-fields'
import { ColumnMapEditor } from './column-map-editor'
import type { EntityNeeds } from '@/types/published-feed'

interface MappingSectionProps {
  needs: EntityNeeds
  staticGtfsRef: string
  onStaticGtfsRefChange: (value: string) => void
  columns: string[]
  fields: GtfsField[]
  selection: Record<string, string | null>
  onSelectionChange: (field: string, column: string | null) => void
  fieldErrors: Record<string, string>
}

/**
 * Split out of feed-form.tsx to keep that file under the size hook, and a
 * component rather than a hook for the reason feed-form-on-failure.tsx gives:
 * the state stays in feed-form.tsx, so no setter escapes into a custom hook and
 * no callback loses its known-stable dependency.
 *
 * Both halves render only when the entity's producer consumes them, so an
 * entity that maps no columns shows no empty table and one that extends no
 * static schedule is not asked for a URL it has nowhere to put. The whole
 * section disappears when neither is needed rather than leaving a heading over
 * nothing.
 */
export function MappingSection({
  needs,
  staticGtfsRef,
  onStaticGtfsRefChange,
  columns,
  fields,
  selection,
  onSelectionChange,
  fieldErrors,
}: MappingSectionProps) {
  const staticGtfsRefId = useId()

  if (!needs.staticReference && !needs.columnMap) return null

  return (
    <div className="space-y-3">
      <h2 className={SUBSECTION_HEADING}>Mapping</h2>
      {needs.staticReference && (
        <div className="space-y-1">
          <Label htmlFor={staticGtfsRefId}>Static GTFS reference</Label>
          <Input
            id={staticGtfsRefId}
            type="text"
            value={staticGtfsRef}
            onChange={(e) => onStaticGtfsRefChange(e.target.value)}
            placeholder="the static feed this realtime feed extends"
          />
        </div>
      )}
      {needs.columnMap && (
        <ColumnMapEditor
          columns={columns}
          fields={fields}
          selection={selection}
          onChange={onSelectionChange}
          fieldErrors={fieldErrors}
        />
      )}
    </div>
  )
}
